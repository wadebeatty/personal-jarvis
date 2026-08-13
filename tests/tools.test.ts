import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequest, installEnv, jsonRequest, sleep, TOOL_ENV } from "./helpers.ts";
import {
  createMemoryBridgeStore,
  setBridgeStoreForTests,
} from "../netlify/functions/_shared/bridge.ts";
import { CONTACTS_UNAVAILABLE_SUMMARY } from "../netlify/functions/_shared/contacts.ts";

function setupBridge(extra: Record<string, string> = {}) {
  const store = createMemoryBridgeStore();
  setBridgeStoreForTests(store);
  installEnv({
    JARVIS_TOOL_SECRET: TOOL_ENV.JARVIS_TOOL_SECRET,
    JARVIS_BRIDGE_TIMEOUT_MS: "2500",
    JARVIS_BRIDGE_POLL_MS: "15",
    ...extra,
  });
  return store;
}

async function waitForPendingJob(
  pending: (req: Request) => Promise<Response>,
  timeoutMs = 1000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await pending(getRequest("https://example.com/.netlify/functions/bridge-pending"));
    assert.equal(res.status, 200);
    const body = await res.json();
    if (Array.isArray(body.jobs) && body.jobs.length > 0) {
      return body.jobs[0] as { id: string; tool: string; args: Record<string, unknown> };
    }
    await sleep(10);
  }
  throw new Error("timed out waiting for a pending bridge job");
}

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

test("bridge admin endpoints reject missing or wrong secrets", async () => {
  const { default: pending } = await import("../netlify/functions/bridge-pending.ts");
  const { default: complete } = await import("../netlify/functions/bridge-complete.ts");

  installEnv({});
  const missing = await pending(getRequest("https://example.com/.netlify/functions/bridge-pending"));
  assert.equal(missing.status, 500);

  installEnv(TOOL_ENV);
  const wrongPending = await pending(
    getRequest("https://example.com/.netlify/functions/bridge-pending", "nope"),
  );
  assert.equal(wrongPending.status, 401);

  const wrongComplete = await complete(
    jsonRequest("https://example.com/.netlify/functions/bridge-complete", { id: "x" }, "nope"),
  );
  assert.equal(wrongComplete.status, 401);
});

test("contacts tool returns sync unavailable without enqueueing a job", async () => {
  setupBridge();
  const { default: contacts } = await import("../netlify/functions/tools-contacts.ts");
  const { default: pending } = await import("../netlify/functions/bridge-pending.ts");

  const response = await contacts(
    jsonRequest("https://example.com/.netlify/functions/tools-contacts", { query: "Pat" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.summary, CONTACTS_UNAVAILABLE_SUMMARY);
  assert.equal("contacts" in body, false);

  const listed = await pending(getRequest("https://example.com/.netlify/functions/bridge-pending"));
  const jobs = (await listed.json()).jobs;
  assert.deepEqual(jobs, []);
});

test("calendar enqueue + complete happy path returns the fulfill payload", async () => {
  setupBridge();
  const { default: calendar } = await import("../netlify/functions/tools-calendar.ts");
  const { default: pending } = await import("../netlify/functions/bridge-pending.ts");
  const { default: complete } = await import("../netlify/functions/bridge-complete.ts");

  const calendarPromise = calendar(
    jsonRequest("https://example.com/.netlify/functions/tools-calendar", { query: "tomorrow" }),
  );

  const job = await waitForPendingJob(pending);
  assert.equal(job.tool, "calendar");
  assert.equal(job.args.query, "tomorrow");
  assert.match(job.id, /^[0-9a-f-]{36}$/i);

  const done = await complete(
    jsonRequest("https://example.com/.netlify/functions/bridge-complete", {
      id: job.id,
      ok: true,
      summary: "2 events tomorrow.",
      events: [
        { when: "Friday, August 14 9:00 AM to 9:30 AM", title: "Standup <b>sync</b>", where: "Zoom" },
        { when: "All day Friday, August 14", title: "Ward council" },
        { when: "extra 3", title: "C" },
        { when: "extra 4", title: "D" },
        { when: "extra 5", title: "E" },
        { when: "extra 6", title: "F" },
      ],
    }),
  );
  assert.equal(done.status, 200);
  assert.equal((await done.json()).ok, true);

  const response = await calendarPromise;
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.summary, "2 events tomorrow.");
  assert.equal(body.events.length, 5);
  assert.equal(body.events[0].title, "Standup sync");
  assert.equal(body.events[0].where, "Zoom");
  assert.equal(JSON.stringify(body).includes("test-jarvis-secret"), false);
  assert.equal(JSON.stringify(body).includes("<b>"), false);
});

test("email enqueue + complete happy path returns snippet fields only", async () => {
  setupBridge();
  const { default: email } = await import("../netlify/functions/tools-email.ts");
  const { default: pending } = await import("../netlify/functions/bridge-pending.ts");
  const { default: complete } = await import("../netlify/functions/bridge-complete.ts");

  const emailPromise = email(
    jsonRequest("https://example.com/.netlify/functions/tools-email", {
      query: "any email from Sarah",
    }),
  );

  const job = await waitForPendingJob(pending);
  assert.equal(job.tool, "email");
  assert.equal(job.args.query, "any email from Sarah");

  const done = await complete(
    jsonRequest("https://example.com/.netlify/functions/bridge-complete", {
      id: job.id,
      ok: true,
      summary: "1 message.",
      messages: [
        {
          from: "Sarah Connor",
          subject: "Invoice",
          date: "Thursday, August 13 at 12:00 PM",
          snippet: "Please see the <b>invoice</b> attached.",
        },
      ],
    }),
  );
  assert.equal(done.status, 200);

  const response = await emailPromise;
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].from, "Sarah Connor");
  assert.equal(body.messages[0].subject, "Invoice");
  assert.equal(body.messages[0].snippet.includes("<"), false);
  assert.equal(body.messages[0].snippet.includes("invoice"), true);
  assert.equal("body" in body.messages[0], false);
});

test("calendar poll timeout returns a speakable ok:false summary", async () => {
  setupBridge({ JARVIS_BRIDGE_TIMEOUT_MS: "60", JARVIS_BRIDGE_POLL_MS: "15" });
  const { default: calendar } = await import("../netlify/functions/tools-calendar.ts");
  const { default: pending } = await import("../netlify/functions/bridge-pending.ts");

  const response = await calendar(
    jsonRequest("https://example.com/.netlify/functions/tools-calendar", { query: "tomorrow" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.match(body.summary, /calendar in time/i);
  assert.equal("events" in body, false);

  const listed = await pending(getRequest("https://example.com/.netlify/functions/bridge-pending"));
  const jobs = (await listed.json()).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "pending");
});
