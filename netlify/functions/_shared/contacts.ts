import { MAX_RESULTS, type ToolInput } from "./http.ts";
import { googleJson } from "./google.ts";
import { countLabel, stripHtml, truncate } from "./speakable.ts";

type PersonName = { displayName?: string; givenName?: string; familyName?: string };
type PersonEmail = { value?: string };
type PersonPhone = { value?: string; canonicalForm?: string };
type Person = {
  names?: PersonName[];
  emailAddresses?: PersonEmail[];
  phoneNumbers?: PersonPhone[];
};

export type SpeakableContact = {
  name: string;
  emails: string[];
  phones: string[];
};

function personName(person: Person): string {
  const primary = person.names?.[0];
  const display = primary?.displayName?.trim();
  if (display) return stripHtml(display);
  const parts = [primary?.givenName, primary?.familyName].filter(Boolean).join(" ");
  return stripHtml(parts) || "Unnamed contact";
}

export function shapeContact(person: Person): SpeakableContact | null {
  const name = personName(person);
  const emails = (person.emailAddresses ?? [])
    .map((e) => e.value?.trim())
    .filter((v): v is string => Boolean(v))
    .slice(0, 3);
  const phones = (person.phoneNumbers ?? [])
    .map((p) => (p.value || p.canonicalForm)?.trim())
    .filter((v): v is string => Boolean(v))
    .slice(0, 3);
  if (name === "Unnamed contact" && emails.length === 0 && phones.length === 0) return null;
  return {
    name: truncate(name, 60),
    emails,
    phones,
  };
}

export function shapeContactsResponse(
  people: Person[],
): { ok: true; summary: string; contacts: SpeakableContact[] } {
  const contacts = people
    .map(shapeContact)
    .filter((c): c is SpeakableContact => Boolean(c))
    .slice(0, MAX_RESULTS);
  const summary = contacts.length
    ? `${countLabel(contacts.length, "contact")}.`
    : "No matching contacts.";
  return { ok: true, summary, contacts };
}

function matchesQuery(person: Person, query: string): boolean {
  const q = query.toLowerCase();
  const hay = [
    personName(person),
    ...(person.emailAddresses ?? []).map((e) => e.value || ""),
    ...(person.phoneNumbers ?? []).map((p) => `${p.value || ""} ${p.canonicalForm || ""}`),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^\w@+.]/g, "");
  const needle = q.replace(/[^\w@+.]/g, "");
  return hay.includes(needle);
}

export async function searchContacts(input: ToolInput) {
  const query = (input.query || "").trim();
  if (!query) {
    return { ok: true, summary: "Say a name, email, or phone to look up.", contacts: [] as SpeakableContact[] };
  }

  const searchUrl = new URL("https://people.googleapis.com/v1/people:searchContacts");
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("readMask", "names,emailAddresses,phoneNumbers");
  searchUrl.searchParams.set("pageSize", String(MAX_RESULTS));

  let people: Person[] = [];
  try {
    const searched = await googleJson<{ results?: { person?: Person }[] }>(searchUrl);
    people = (searched.results ?? []).map((r) => r.person).filter((p): p is Person => Boolean(p));
  } catch {
    people = [];
  }

  if (people.length === 0) {
    const listUrl = new URL("https://people.googleapis.com/v1/people/me/connections");
    listUrl.searchParams.set("personFields", "names,emailAddresses,phoneNumbers");
    listUrl.searchParams.set("pageSize", "50");
    try {
      const listed = await googleJson<{ connections?: Person[] }>(listUrl);
      people = (listed.connections ?? []).filter((p) => matchesQuery(p, query));
    } catch {
      people = [];
    }
  }

  return shapeContactsResponse(people);
}
