import { MAX_RESULTS, type ToolInput } from "./http.ts";
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

/** Accept speakable messages or Gmail-like payloads from the fulfill agent. */
export function normalizeEmailPayload(payload: unknown): SpeakableMessage[] {
  const obj =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const list = Array.isArray(obj.messages) ? obj.messages : Array.isArray(payload) ? payload : [];

  const out: SpeakableMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.from === "string" && typeof rec.subject === "string") {
      out.push({
        from: truncate(stripHtml(rec.from), 80),
        subject: truncate(stripHtml(rec.subject), 80),
        date: typeof rec.date === "string" ? truncate(stripHtml(rec.date), 80) : "unknown date",
        snippet: truncate(typeof rec.snippet === "string" ? rec.snippet : "", 140),
      });
    } else {
      out.push(shapeEmailMessage(rec as GmailMessage));
    }
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
