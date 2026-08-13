import { test } from "node:test";
import assert from "node:assert/strict";
import { installEnv, jsonRequest, TOOL_ENV } from "./helpers.ts";
import { resetGoogleAuthCache } from "../netlify/functions/_shared/google.ts";

test("tool endpoints reject missing, wrong, or absent secrets and non-POST", async () => {
  const { default: calendar } = await import("../netlify/functions/tools-calendar.ts");

  installEnv({});
  const missingSecret = await calendar(
    jsonRequest("https://example.com/.netlify/functions/tools-calendar", { query: "tomorrow" }),
  );
  assert.equal(missingSecret.status, 500);
  assert.equal((await missingSecret.json()).error, "Server is missing JARVIS_TOOL_SECRET");

  installEnv(TOOL_ENV);
  const wrong = await calendar(
    jsonRequest(
      "https://example.com/.netlify/functions/tools-calendar",
      { query: "tomorrow" },
      "nope",
    ),
  );
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "Unauthorized");

  const noHeader = await calendar(
    new Request("https://example.com/.netlify/functions/tools-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "tomorrow" }),
    }),
  );
  assert.equal(noHeader.status, 401);

  const get = await calendar(new Request("https://example.com/.netlify/functions/tools-calendar"));
  assert.equal(get.status, 405);
});

test("calendar tool returns a speakable error when Google env is missing", async () => {
  installEnv({ JARVIS_TOOL_SECRET: TOOL_ENV.JARVIS_TOOL_SECRET });
  const { default: calendar } = await import("../netlify/functions/tools-calendar.ts");
  const response = await calendar(
    jsonRequest("https://example.com/.netlify/functions/tools-calendar", { query: "tomorrow" }),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.match(body.summary, /Google access is not configured/);
});

test("calendar tool shapes speakable events and never leaks secrets", async (t) => {
  installEnv(TOOL_ENV);
  resetGoogleAuthCache();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/calendar/v3/") || u.includes("calendar.googleapis.com")) {
      assert.match(u, /timeZone=America%2FDenver/);
      assert.match(u, /maxResults=5/);
      return new Response(
        JSON.stringify({
          items: [
            {
              summary: "Standup <b>sync</b>",
              start: { dateTime: "2026-08-14T09:00:00-06:00" },
              end: { dateTime: "2026-08-14T09:30:00-06:00" },
              location: "Zoom",
            },
            {
              summary: "Cancelled",
              status: "cancelled",
              start: { dateTime: "2026-08-14T10:00:00-06:00" },
            },
            {
              summary: "Ward council",
              start: { date: "2026-08-14" },
              end: { date: "2026-08-15" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  });

  const { default: calendar } = await import("../netlify/functions/tools-calendar.ts");
  const response = await calendar(
    jsonRequest("https://example.com/.netlify/functions/tools-calendar", { query: "tomorrow" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.summary, /2 events/);
  assert.equal(body.events.length, 2);
  assert.equal(body.events[0].title, "Standup sync");
  assert.match(body.events[0].when, /9:00 AM/);
  assert.equal(body.events[0].where, "Zoom");
  assert.match(body.events[1].when, /All day/);
  assert.equal(JSON.stringify(body).includes("test-jarvis-secret"), false);
  assert.equal(JSON.stringify(body).includes("<b>"), false);
});

test("email tool maps natural query, returns snippet fields only, caps at 5", async (t) => {
  installEnv(TOOL_ENV);
  resetGoogleAuthCache();
  const seen: string[] = [];

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/gmail/v1/users/me/messages?") && !u.includes("/messages/m")) {
      assert.match(decodeURIComponent(u), /from:Sarah/);
      return new Response(
        JSON.stringify({
          messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }, { id: "m5" }, { id: "m6" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/gmail/v1/users/me/messages/m")) {
      const id = u.match(/messages\/(m\d)/)?.[1];
      return new Response(
        JSON.stringify({
          id,
          snippet: "Please see the <b>invoice</b> attached.",
          internalDate: "1750000000000",
          payload: {
            headers: [
              { name: "From", value: "Sarah Connor <sarah@example.com>" },
              { name: "Subject", value: "Invoice" },
              { name: "Date", value: "Wed, 13 Aug 2026 12:00:00 -0600" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  });

  const { default: email } = await import("../netlify/functions/tools-email.ts");
  const response = await email(
    jsonRequest("https://example.com/.netlify/functions/tools-email", {
      query: "any email from Sarah",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.messages.length, 5);
  assert.equal(body.messages[0].from, "Sarah Connor");
  assert.equal(body.messages[0].subject, "Invoice");
  assert.equal(body.messages[0].snippet.includes("<"), false);
  assert.equal(body.messages[0].snippet.includes("invoice"), true);
  assert.equal("body" in body.messages[0], false);
  assert.equal(JSON.stringify(body).includes("refresh-token"), false);
});

test("contacts tool returns name, emails, phones and falls back to connections", async (t) => {
  installEnv(TOOL_ENV);
  resetGoogleAuthCache();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("people:searchContacts")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("people/me/connections")) {
      return new Response(
        JSON.stringify({
          connections: [
            {
              names: [{ displayName: "Pat Lee" }],
              emailAddresses: [{ value: "pat@example.com" }],
              phoneNumbers: [{ value: "+1 435-555-0100" }],
            },
            {
              names: [{ displayName: "Other Person" }],
              emailAddresses: [{ value: "other@example.com" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected", { status: 500 });
  });

  const { default: contacts } = await import("../netlify/functions/tools-contacts.ts");
  const response = await contacts(
    jsonRequest("https://example.com/.netlify/functions/tools-contacts", { query: "Pat" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.contacts.length, 1);
  assert.equal(body.contacts[0].name, "Pat Lee");
  assert.deepEqual(body.contacts[0].emails, ["pat@example.com"]);
  assert.deepEqual(body.contacts[0].phones, ["+1 435-555-0100"]);
});
