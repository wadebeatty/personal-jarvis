import { MAX_RESULTS } from "./http.ts";
import { countLabel, stripHtml, truncate } from "./speakable.ts";

export const CONTACTS_UNAVAILABLE_SUMMARY =
  "Contacts aren’t on a Grok Bot connector yet — ask about email or calendar instead.";

export function contactsUnavailable(): { ok: false; summary: string } {
  return { ok: false, summary: CONTACTS_UNAVAILABLE_SUMMARY };
}

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

