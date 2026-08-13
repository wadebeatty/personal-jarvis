import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { env } from "./env.ts";
import { MAX_RESULTS, type ToolInput } from "./http.ts";
import { normalizeCalendarPayload } from "./calendar.ts";
import { normalizeEmailPayload } from "./email.ts";
import { countLabel, stripHtml, truncate } from "./speakable.ts";

export type BridgeTool = "calendar" | "email" | "contacts";
export type BridgeJobStatus = "pending" | "done" | "error";

export type BridgeJob = {
  id: string;
  tool: BridgeTool;
  args: Record<string, unknown>;
  createdAt: string;
  status: BridgeJobStatus;
  result?: Record<string, unknown>;
};

export type BridgeStore = {
  setJSON(key: string, value: unknown): Promise<void>;
  getJSON<T>(key: string): Promise<T | null>;
  listKeys(): Promise<string[]>;
};

const STORE_NAME = "jarvis-bridge";
const DEFAULT_TIMEOUT_MS = 18_000;
const DEFAULT_POLL_MS = 400;
const PENDING_MAX_AGE_MS = 90_000;
const PENDING_LIMIT = 10;

let testStore: BridgeStore | null = null;

export function setBridgeStoreForTests(store: BridgeStore | null) {
  testStore = store;
}

export function createMemoryBridgeStore(): BridgeStore {
  const map = new Map<string, string>();
  return {
    async setJSON(key, value) {
      map.set(key, JSON.stringify(value));
    },
    async getJSON(key) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      return JSON.parse(raw) as never;
    },
    async listKeys() {
      return [...map.keys()];
    },
  };
}

export function getBridgeStore(): BridgeStore {
  if (testStore) return testStore;
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    return {
      async setJSON(key, value) {
        await store.setJSON(key, value);
      },
      async getJSON(key) {
        const data = await store.get(key, { type: "json" });
        return (data ?? null) as never;
      },
      async listKeys() {
        const { blobs } = await store.list();
        return blobs.map((b) => b.key);
      },
    };
  } catch {
    throw new Error("bridge-store-unavailable");
  }
}

function pollTimeoutMs(): number {
  const n = Number(env("JARVIS_BRIDGE_TIMEOUT_MS"));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function pollIntervalMs(): number {
  const n = Number(env("JARVIS_BRIDGE_POLL_MS"));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toolArgs(tool: "calendar" | "email", input: ToolInput): Record<string, unknown> {
  if (tool === "calendar") {
    return { query: input.query, start: input.start, end: input.end };
  }
  return { query: input.query, q: input.q };
}

function publicJob(job: BridgeJob) {
  return {
    id: job.id,
    tool: job.tool,
    args: job.args,
    createdAt: job.createdAt,
    status: job.status,
  };
}

function timeoutSummary(tool: "calendar" | "email"): string {
  return tool === "calendar"
    ? "I couldn’t check your calendar in time. Try again in a moment."
    : "I couldn’t check your email in time. Try again in a moment.";
}

function speakableFromJob(job: BridgeJob): Record<string, unknown> {
  const result = job.result;
  const failed = job.status === "error" || !result || result.ok === false;
  if (failed) {
    const summary =
      typeof result?.summary === "string" && result.summary.trim()
        ? result.summary
        : "Something went wrong looking that up.";
    return { ok: false, summary };
  }

  const summary =
    typeof result.summary === "string" && result.summary.trim() ? result.summary : "Done.";

  if (job.tool === "calendar") {
    const events = Array.isArray(result.events) ? result.events.slice(0, MAX_RESULTS) : [];
    return { ok: true, summary, events };
  }
  const messages = Array.isArray(result.messages) ? result.messages.slice(0, MAX_RESULTS) : [];
  return { ok: true, summary, messages };
}

export async function enqueueAndWait(
  tool: "calendar" | "email",
  input: ToolInput,
): Promise<Record<string, unknown>> {
  const store = getBridgeStore();
  const job: BridgeJob = {
    id: randomUUID(),
    tool,
    args: toolArgs(tool, input),
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await store.setJSON(job.id, job);

  const deadline = Date.now() + pollTimeoutMs();
  const interval = pollIntervalMs();

  while (Date.now() < deadline) {
    const current = await store.getJSON<BridgeJob>(job.id);
    if (current && (current.status === "done" || current.status === "error")) {
      return speakableFromJob(current);
    }
    const wait = Math.min(interval, deadline - Date.now());
    if (wait <= 0) break;
    await sleep(wait);
  }

  return { ok: false, summary: timeoutSummary(tool) };
}

export async function listPendingJobs(limit = PENDING_LIMIT): Promise<ReturnType<typeof publicJob>[]> {
  const store = getBridgeStore();
  const keys = await store.listKeys();
  const jobs: BridgeJob[] = [];
  const now = Date.now();

  for (const key of keys) {
    const job = await store.getJSON<BridgeJob>(key);
    if (!job || job.status !== "pending" || !job.id || !job.createdAt) continue;
    const created = Date.parse(job.createdAt);
    if (Number.isFinite(created) && now - created > PENDING_MAX_AGE_MS) continue;
    jobs.push(job);
  }

  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return jobs.slice(0, limit).map(publicJob);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function spokenSummary(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return truncate(stripHtml(value), 200);
  }
  return fallback;
}

export async function completeBridgeJob(
  body: Record<string, unknown>,
): Promise<{ ok: true; id: string } | { error: string; status: number }> {
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return { error: "Missing id", status: 400 };

  const store = getBridgeStore();
  const job = await store.getJSON<BridgeJob>(id);
  if (!job) return { error: "Unknown job", status: 404 };

  const ok = body.ok === true;
  let result: Record<string, unknown>;

  if (!ok) {
    result = {
      ok: false,
      summary: spokenSummary(body.summary, "Something went wrong looking that up."),
    };
  } else if (job.tool === "calendar") {
    const events = normalizeCalendarPayload(body);
    result = {
      ok: true,
      summary: spokenSummary(
        body.summary,
        events.length ? `${countLabel(events.length, "event")}.` : "No matching events.",
      ),
      events,
    };
  } else if (job.tool === "email") {
    const messages = normalizeEmailPayload(body);
    result = {
      ok: true,
      summary: spokenSummary(
        body.summary,
        messages.length ? `${countLabel(messages.length, "message")}.` : "No matching email.",
      ),
      messages,
    };
  } else {
    result = {
      ok: true,
      summary: spokenSummary(body.summary, "Done."),
    };
  }

  const next: BridgeJob = { ...job, status: "done", result };
  await store.setJSON(id, next);
  return { ok: true, id };
}

export function parseCompleteBody(value: unknown): Record<string, unknown> | null {
  return asRecord(value);
}
