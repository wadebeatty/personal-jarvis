import { MAX_RESULTS, type ToolInput } from "./http.ts";
import { googleJson } from "./google.ts";
import { addDays, formatSpokenDateTime, startOfDay, wallTime } from "./denver.ts";
import { countLabel, displayFrom, stripHtml, truncate } from "./speakable.ts";

const GMAIL_OPERATORS =
  /\b(from:|to:|subject:|is:|in:|label:|after:|before:|newer_than:|older_than:|has:|filename:|rfc822msgid:|category:)\b/i;

function ymd(date: Date): string {
  const w = wallTime(date);
  return `${w.year}/${String(w.month).padStart(2, "0")}/${String(w.day).padStart(2, "0")}`;
}

export function toGmailQuery(input: ToolInput, now = new Date()): string {
  const explicit = (input.q || "").trim();
  const raw = (explicit || input.query || "").trim();
  if (!raw) return "newer_than:7d";
  if (GMAIL_OPERATORS.test(raw)) return raw;

  const lowered = raw.toLowerCase();
  const today = startOfDay(now);

  const fromMatch = raw.match(
    /\bfrom\s+(.+?)(?=\s+(?:about|regarding|re|today|yesterday|this week|unread)\b|$)/i,
  );
  if (fromMatch) {
    const who = fromMatch[1].replace(/^(?:any\s+)?(?:e-?mails?|mail|messages?|threads?)\s+/i, "").trim();
    const parts = [`from:${who.replace(/^["']|["']$/g, "")}`];
    if (/\bunread\b/i.test(raw)) parts.push("is:unread");
    if (/\btoday\b/i.test(raw)) parts.push(`after:${ymd(today)}`);
    if (/\byesterday\b/i.test(raw)) {
      const y = addDays(today, -1);
      parts.push(`after:${ymd(y)}`, `before:${ymd(today)}`);
    }
    const about = raw.match(/\b(?:about|regarding|re)\s+(.+)$/i);
    if (about) parts.push(about[1].replace(/\b(today|yesterday|unread)\b/gi, "").trim());
    return parts.filter(Boolean).join(" ");
  }

  if (/^(?:any\s+)?unread\b/i.test(lowered)) {
    return "is:unread newer_than:14d";
  }

  const about = raw.match(/^(?:e-?mails?|mail|messages?)\s+(?:about|regarding|re)\s+(.+)$/i);
  if (about) return about[1].trim();

  if (/\btoday\b/i.test(raw) && !GMAIL_OPERATORS.test(raw)) {
    const rest = raw.replace(/\btoday\b/gi, "").trim();
    return [rest, `after:${ymd(today)}`].filter(Boolean).join(" ");
  }

  return raw;
}

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

export type SpeakableMessage = {
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || "";
}

export function shapeEmailMessage(message: GmailMessage): SpeakableMessage {
  const fromRaw = header(message, "From");
  const subject = stripHtml(header(message, "Subject") || "(no subject)");
  const dateHeader = header(message, "Date");
  const internal = message.internalDate ? new Date(Number(message.internalDate)) : null;
  const parsedHeader = dateHeader ? new Date(dateHeader) : null;
  const when =
    internal && !Number.isNaN(internal.getTime())
      ? internal
      : parsedHeader && !Number.isNaN(parsedHeader.getTime())
        ? parsedHeader
        : null;
  return {
    from: displayFrom(fromRaw) || "Unknown sender",
    subject: truncate(subject, 80),
    date: when ? formatSpokenDateTime(when) : "unknown date",
    snippet: truncate(message.snippet || "", 140),
  };
}

export function shapeEmailResponse(
  messages: GmailMessage[],
): { ok: true; summary: string; messages: SpeakableMessage[] } {
  const shaped = messages.map(shapeEmailMessage).slice(0, MAX_RESULTS);
  const summary = shaped.length
    ? `${countLabel(shaped.length, "message")}.`
    : "No matching email.";
  return { ok: true, summary, messages: shaped };
}

export async function searchEmail(input: ToolInput, now = new Date()) {
  const q = toGmailQuery(input, now);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("maxResults", String(MAX_RESULTS));

  const list = await googleJson<{ messages?: { id: string }[] }>(listUrl);
  const ids = (list.messages ?? []).slice(0, MAX_RESULTS).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) {
    return shapeEmailResponse([]);
  }

  const messages: GmailMessage[] = [];
  for (const id of ids) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    url.searchParams.set("format", "metadata");
    url.searchParams.set("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "Subject");
    url.searchParams.append("metadataHeaders", "Date");
    try {
      messages.push(await googleJson<GmailMessage>(url));
    } catch {
      // Skip a single failed fetch; still return the rest.
    }
  }

  return shapeEmailResponse(messages);
}
