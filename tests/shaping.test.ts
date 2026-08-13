import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCalendarWindow, shapeCalendarEvent, shapeCalendarResponse, normalizeCalendarPayload } from "../netlify/functions/_shared/calendar.ts";
import { toGmailQuery, shapeEmailMessage, shapeEmailResponse, normalizeEmailPayload } from "../netlify/functions/_shared/email.ts";
import { shapeContact, shapeContactsResponse } from "../netlify/functions/_shared/contacts.ts";
import { zonedInstant, wallTime, addDays, startOfDay } from "../netlify/functions/_shared/denver.ts";
import { stripHtml, displayFrom } from "../netlify/functions/_shared/speakable.ts";

const noonMst = zonedInstant(2026, 8, 13, 12, 0, 0); // Thursday

test("Denver DST-safe civil time round-trips", () => {
  const winter = zonedInstant(2026, 1, 15, 9, 30, 0);
  const w = wallTime(winter);
  assert.equal(w.year, 2026);
  assert.equal(w.month, 1);
  assert.equal(w.day, 15);
  assert.equal(w.hour, 9);
  assert.equal(w.minute, 30);

  const summer = zonedInstant(2026, 7, 15, 9, 30, 0);
  const s = wallTime(summer);
  assert.equal(s.hour, 9);
  assert.equal(s.month, 7);
});

test("calendar window maps tomorrow / today / ISO and leftover search text", () => {
  const tomorrow = resolveCalendarWindow({ query: "what's on my calendar tomorrow", q: "", start: "", end: "", raw: {} }, noonMst);
  assert.equal(tomorrow.label, "tomorrow");
  assert.equal(tomorrow.q, "");
  const tWall = wallTime(tomorrow.timeMin);
  assert.equal(tWall.day, 14);
  assert.equal(tWall.hour, 0);
  const tMax = wallTime(tomorrow.timeMax);
  assert.equal(tMax.day, 15);

  const dentist = resolveCalendarWindow({ query: "dentist tomorrow", q: "", start: "", end: "", raw: {} }, noonMst);
  assert.equal(dentist.label, "tomorrow");
  assert.equal(dentist.q, "dentist");

  const today = resolveCalendarWindow({ query: "today", q: "", start: "", end: "", raw: {} }, noonMst);
  assert.equal(today.label, "today");
  assert.equal(wallTime(today.timeMin).hour, 12);

  const iso = resolveCalendarWindow({ query: "2026-08-20", q: "", start: "", end: "", raw: {} }, noonMst);
  assert.equal(iso.label, "2026-08-20");
  assert.equal(wallTime(iso.timeMin).day, 20);

  const ranged = resolveCalendarWindow(
    { query: "tomorrow", q: "", start: "2026-08-20T00:00:00-06:00", end: "2026-08-21T00:00:00-06:00", raw: {} },
    noonMst,
  );
  assert.equal(ranged.label, "that range");
  assert.equal(wallTime(ranged.timeMin).day, 20);
});

test("calendar shaping strips HTML, skips cancelled, caps at 5", () => {
  const cancelled = shapeCalendarEvent({
    summary: "Nope",
    status: "cancelled",
    start: { dateTime: "2026-08-14T09:00:00-06:00" },
  });
  assert.equal(cancelled, null);

  const shaped = shapeCalendarResponse(
    [
      { summary: "A <i>meet</i>", start: { dateTime: "2026-08-14T09:00:00-06:00" }, end: { dateTime: "2026-08-14T10:00:00-06:00" } },
      { summary: "B", start: { dateTime: "2026-08-14T11:00:00-06:00" } },
      { summary: "C", start: { dateTime: "2026-08-14T12:00:00-06:00" } },
      { summary: "D", start: { dateTime: "2026-08-14T13:00:00-06:00" } },
      { summary: "E", start: { dateTime: "2026-08-14T14:00:00-06:00" } },
      { summary: "F", start: { dateTime: "2026-08-14T15:00:00-06:00" } },
    ],
    { timeMin: noonMst, timeMax: addDays(startOfDay(noonMst), 1), label: "tomorrow", q: "" },
  );
  assert.equal(shaped.events.length, 5);
  assert.equal(shaped.events[0].title, "A meet");
  assert.match(shaped.events[0].when, /9:00 AM to 10:00 AM/);
  assert.match(shaped.summary, /5 events tomorrow/);
});

test("normalizeCalendarPayload and normalizeEmailPayload cap at 5 and strip HTML", () => {
  const events = normalizeCalendarPayload({
    events: Array.from({ length: 7 }, (_, i) => ({
      when: `slot ${i}`,
      title: i === 0 ? "Standup <b>sync</b>" : `E${i}`,
    })),
  });
  assert.equal(events.length, 5);
  assert.equal(events[0].title, "Standup sync");

  const fromGoogle = normalizeCalendarPayload({
    items: [
      {
        summary: "Dentist",
        start: { dateTime: "2026-08-14T09:00:00-06:00" },
        end: { dateTime: "2026-08-14T09:30:00-06:00" },
      },
    ],
  });
  assert.equal(fromGoogle[0].title, "Dentist");
  assert.match(fromGoogle[0].when, /9:00 AM/);

  const messages = normalizeEmailPayload({
    messages: Array.from({ length: 8 }, (_, i) => ({
      from: "Ada",
      subject: `S${i}`,
      date: "Thursday, August 13 at 12:00 PM",
      snippet: i === 0 ? "Hello <b>there</b>" : `n${i}`,
    })),
  });
  assert.equal(messages.length, 5);
  assert.equal(messages[0].snippet, "Hello there");
});

test("gmail query mapping and speakable email shaping", () => {
  assert.equal(toGmailQuery({ query: "", q: "", start: "", end: "", raw: {} }), "newer_than:7d");
  assert.equal(
    toGmailQuery({ query: "from:ada@example.com newer_than:14d", q: "", start: "", end: "", raw: {} }),
    "from:ada@example.com newer_than:14d",
  );
  assert.match(toGmailQuery({ query: "any email from Sarah", q: "", start: "", end: "", raw: {} }), /^from:Sarah$/);
  assert.equal(toGmailQuery({ query: "unread", q: "", start: "", end: "", raw: {} }), "is:unread newer_than:14d");

  const msg = shapeEmailMessage({
    snippet: "Hello <b>there</b> &amp; welcome",
    internalDate: String(Date.parse("2026-08-13T18:00:00-06:00")),
    payload: {
      headers: [
        { name: "From", value: '"Ada Lovelace" <ada@example.com>' },
        { name: "Subject", value: "Hello" },
      ],
    },
  });
  assert.equal(msg.from, "Ada Lovelace");
  assert.equal(msg.snippet, "Hello there & welcome");
  assert.match(msg.date, /August 13/);

  const many = shapeEmailResponse(Array.from({ length: 8 }, (_, i) => ({
    snippet: `n${i}`,
    payload: { headers: [{ name: "From", value: "a@b.c" }, { name: "Subject", value: `S${i}` }] },
  })));
  assert.equal(many.messages.length, 5);
});

test("contacts shaping and HTML stripping helpers", () => {
  assert.equal(stripHtml("<p>Hi &nbsp; there</p>"), "Hi there");
  assert.equal(displayFrom("Jane Doe <jane@x.com>"), "Jane Doe");

  const unnamed = shapeContact({ emailAddresses: [], phoneNumbers: [] });
  assert.equal(unnamed, null);

  const shaped = shapeContactsResponse([
    {
      names: [{ displayName: "<b>Pat</b> Lee" }],
      emailAddresses: [{ value: "pat@example.com" }, { value: "p@x.com" }, { value: "p2@x.com" }, { value: "p3@x.com" }],
      phoneNumbers: [{ value: "435-555-0100" }],
    },
  ]);
  assert.equal(shaped.contacts[0].name, "Pat Lee");
  assert.equal(shaped.contacts[0].emails.length, 3);
  assert.match(shaped.summary, /1 contact/);
});
