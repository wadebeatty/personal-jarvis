export const DENVER_TZ = "America/Denver";

export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function wallTime(date: Date, timeZone = DENVER_TZ): WallTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
  };
}

function wallOffsetMs(date: Date, timeZone: string): number {
  const wall = wallTime(date, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - date.getTime();
}

/** Instant corresponding to a civil datetime in America/Denver (handles DST). */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = DENVER_TZ,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = new Date(utcGuess - wallOffsetMs(new Date(utcGuess), timeZone));
  const wall = wallTime(first, timeZone);
  if (
    wall.year === year &&
    wall.month === month &&
    wall.day === day &&
    wall.hour === hour &&
    wall.minute === minute
  ) {
    return first;
  }
  return new Date(utcGuess - wallOffsetMs(first, timeZone));
}

export function startOfDay(date: Date, timeZone = DENVER_TZ): Date {
  const w = wallTime(date, timeZone);
  return zonedInstant(w.year, w.month, w.day, 0, 0, 0, timeZone);
}

export function addDays(date: Date, days: number, timeZone = DENVER_TZ): Date {
  const w = wallTime(date, timeZone);
  const utcNoon = Date.UTC(w.year, w.month - 1, w.day, 12, 0, 0);
  const shifted = new Date(utcNoon + days * 86400000);
  const sw = wallTime(shifted, "UTC");
  return zonedInstant(sw.year, sw.month, sw.day, 0, 0, 0, timeZone);
}

export function weekdayIndex(date: Date, timeZone = DENVER_TZ): number {
  const name = wallTime(date, timeZone).weekday.slice(0, 3);
  const idx = WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);
  return idx === -1 ? 0 : idx;
}

export function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${period}`;
}

const WEEKDAY_LONG: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatWeekdayDate(date: Date, timeZone = DENVER_TZ): string {
  const w = wallTime(date, timeZone);
  const weekday = WEEKDAY_LONG[w.weekday] || w.weekday;
  return `${weekday}, ${MONTH_LONG[w.month - 1]} ${w.day}`;
}

export function formatSpokenDateTime(date: Date, timeZone = DENVER_TZ): string {
  const w = wallTime(date, timeZone);
  return `${formatWeekdayDate(date, timeZone)} at ${formatClock(w.hour, w.minute)}`;
}

export function toRfc3339(date: Date): string {
  return date.toISOString();
}

export function parseIso(value: string): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}
