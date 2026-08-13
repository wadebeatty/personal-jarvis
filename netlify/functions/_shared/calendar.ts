import { MAX_RESULTS, type ToolInput } from "./http.ts";
import { googleJson } from "./google.ts";
import {
  DENVER_TZ,
  addDays,
  formatClock,
  formatWeekdayDate,
  parseIso,
  startOfDay,
  toRfc3339,
  wallTime,
  weekdayIndex,
  zonedInstant,
} from "./denver.ts";
import { stripHtml, truncate, countLabel } from "./speakable.ts";

export type CalendarWindow = {
  timeMin: Date;
  timeMax: Date;
  label: string;
  q: string;
};

const FILLER =
  /\b(what'?s|what is|whats|show|tell me|do i have|anything|any|on my|my|the|a|an|calendar|schedule|agenda|events?|meetings?|appointments?|please|for)\b/gi;

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function upcomingWeekday(from: Date, target: number, wantNext: boolean): Date {
  const todayStart = startOfDay(from);
  const current = weekdayIndex(todayStart);
  let delta = (target - current + 7) % 7;
  if (wantNext) {
    delta = delta === 0 ? 7 : delta;
  }
  return addDays(todayStart, delta);
}

function sundayOfWeek(from: Date): Date {
  return addDays(startOfDay(from), -weekdayIndex(from));
}

export function resolveCalendarWindow(input: ToolInput, now = new Date()): CalendarWindow {
  const start = parseIso(input.start);
  const end = parseIso(input.end);
  const raw = (input.query || "").trim();
  const lowered = raw.toLowerCase();

  let q = "";
  let timeMin: Date | null = start;
  let timeMax: Date | null = end;
  let label = "upcoming";

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const applyRange = (min: Date, max: Date, rangeLabel: string) => {
    if (!timeMin) timeMin = min;
    if (!timeMax) timeMax = max;
    label = rangeLabel;
  };

  const stripped = lowered.replace(FILLER, " ").replace(/\s+/g, " ").trim();

  const isoDate = stripped.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const nextWeekdayMatch = stripped.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
  );
  const weekdayMatch = stripped.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
  );

  if (/\btomorrow\b/.test(stripped)) {
    applyRange(tomorrow, addDays(tomorrow, 1), "tomorrow");
  } else if (/\btonight\b/.test(stripped)) {
    applyRange(now, tomorrow, "tonight");
  } else if (/\btoday\b/.test(stripped)) {
    applyRange(now, tomorrow, "today");
  } else if (stripped === "" || stripped === "upcoming") {
    applyRange(now, addDays(today, 2), "upcoming");
  } else if (/\bthis weekend\b/.test(stripped)) {
    const saturday = upcomingWeekday(now, 6, false);
    applyRange(saturday, addDays(saturday, 2), "this weekend");
  } else if (/\bnext weekend\b/.test(stripped)) {
    const thisSat = upcomingWeekday(now, 6, false);
    const nextSat = weekdayIndex(now) === 6 ? addDays(thisSat, 7) : addDays(thisSat, 7);
    applyRange(nextSat, addDays(nextSat, 2), "next weekend");
  } else if (/\bnext week\b/.test(stripped)) {
    const nextSun = addDays(sundayOfWeek(now), 7);
    applyRange(nextSun, addDays(nextSun, 7), "next week");
  } else if (/\bthis week\b/.test(stripped)) {
    const sun = sundayOfWeek(now);
    applyRange(now, addDays(sun, 7), "this week");
  } else if (nextWeekdayMatch) {
    const target = WEEKDAY_NAMES[nextWeekdayMatch[1]];
    const day = upcomingWeekday(now, target, true);
    applyRange(day, addDays(day, 1), `next ${nextWeekdayMatch[1]}`);
  } else if (weekdayMatch) {
    const target = WEEKDAY_NAMES[weekdayMatch[1]];
    const day = upcomingWeekday(now, target, false);
    applyRange(day, addDays(day, 1), weekdayMatch[1]);
  } else if (isoDate) {
    const [y, m, d] = isoDate[1].split("-").map(Number);
    const denverDay = zonedInstant(y, m, d);
    applyRange(denverDay, addDays(denverDay, 1), isoDate[1]);
  }

  const timeWords =
    /\b(today|tonight|tomorrow|this week|next week|this weekend|next weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|upcoming|\d{4}-\d{2}-\d{2})\b/g;
  q = stripped.replace(timeWords, " ").replace(/\s+/g, " ").trim();

  if (!timeMin) timeMin = now;
  if (!timeMax) timeMax = addDays(today, 7);

  if (start) timeMin = start;
  if (end) timeMax = end;
  if (start || end) label = "that range";

  return { timeMin, timeMax, label, q };
}

type GoogleEvent = {
  summary?: string;
  status?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
};

export type SpeakableEvent = {
  when: string;
  title: string;
  where?: string;
};

export function shapeCalendarEvent(event: GoogleEvent): SpeakableEvent | null {
  if (event.status === "cancelled") return null;
  const title = stripHtml(event.summary || "Busy");
  const startRaw = event.start?.dateTime || event.start?.date;
  if (!startRaw) return null;

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  if (allDay) {
    const start = parseIso(`${startRaw}T12:00:00`) ?? parseIso(startRaw);
    if (!start) return null;
    return {
      when: `All day ${formatWeekdayDate(start)}`,
      title: truncate(title, 80),
      where: event.location ? truncate(stripHtml(event.location), 60) : undefined,
    };
  }

  const start = parseIso(startRaw);
  if (!start) return null;
  const end = event.end?.dateTime ? parseIso(event.end.dateTime) : null;
  const sw = wallTime(start);
  let when = `${formatWeekdayDate(start)} at ${formatClock(sw.hour, sw.minute)}`;
  if (end) {
    const ew = wallTime(end);
    const sameDay = sw.year === ew.year && sw.month === ew.month && sw.day === ew.day;
    if (sameDay) {
      when = `${formatWeekdayDate(start)} ${formatClock(sw.hour, sw.minute)} to ${formatClock(ew.hour, ew.minute)}`;
    }
  }

  const where = event.location ? truncate(stripHtml(event.location), 60) : undefined;
  return { when, title: truncate(title, 80), ...(where ? { where } : {}) };
}

export function shapeCalendarResponse(
  events: GoogleEvent[],
  window: CalendarWindow,
): { ok: true; summary: string; events: SpeakableEvent[] } {
  const shaped = events
    .map(shapeCalendarEvent)
    .filter((e): e is SpeakableEvent => Boolean(e))
    .slice(0, MAX_RESULTS);

  const summary = shaped.length
    ? `${countLabel(shaped.length, "event")} ${window.label}.`
    : `No events ${window.label}.`;

  return { ok: true, summary, events: shaped };
}

export async function searchCalendar(input: ToolInput, now = new Date()) {
  const window = resolveCalendarWindow(input, now);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", toRfc3339(window.timeMin));
  url.searchParams.set("timeMax", toRfc3339(window.timeMax));
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(MAX_RESULTS));
  url.searchParams.set("timeZone", DENVER_TZ);
  if (window.q) url.searchParams.set("q", window.q);

  const payload = await googleJson<{ items?: GoogleEvent[] }>(url);
  return shapeCalendarResponse(payload.items ?? [], window);
}
