import { timingSafeEqual } from "node:crypto";
import { env } from "./env.ts";

export const MAX_RESULTS = 5;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function speakableError(summary: string, status = 200): Response {
  return json({ ok: false, summary }, status);
}

function normalizeSecret(value: string): Buffer {
  return Buffer.from(value.normalize("NFC"));
}

export function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = normalizeSecret(provided);
  const b = normalizeSecret(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Require X-Jarvis-Secret. Returns a Response to send, or null if the request is allowed. */
export function rejectUnlessToolSecret(req: Request): Response | null {
  const expected = env("JARVIS_TOOL_SECRET");
  if (!expected) {
    return json({ error: "Server is missing JARVIS_TOOL_SECRET" }, 500);
  }
  const provided = req.headers.get("X-Jarvis-Secret");
  if (!secretsMatch(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

export type ToolInput = {
  query: string;
  q: string;
  start: string;
  end: string;
  raw: Record<string, unknown>;
};

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function collectFields(source: Record<string, unknown>, into: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    into[key] = value;
  }
}

/**
 * Merge JSON body + query string. ElevenLabs webhook tools POST JSON;
 * query-string fallbacks help local curl checks.
 */
export async function parseToolInput(req: Request): Promise<ToolInput> {
  const raw: Record<string, unknown> = {};
  const url = new URL(req.url);
  for (const [key, value] of url.searchParams.entries()) {
    raw[key] = value;
  }

  const text = await req.text();
  if (text.trim()) {
    try {
      const body = JSON.parse(text) as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const obj = body as Record<string, unknown>;
        collectFields(obj, raw);
        for (const nestedKey of ["parameters", "data", "input"]) {
          const nested = obj[nestedKey];
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            collectFields(nested as Record<string, unknown>, raw);
          }
        }
      }
    } catch {
      // Non-JSON bodies are ignored; query params still apply.
    }
  }

  const query = asString(raw.query) || asString(raw.q) || asString(raw.search);
  return {
    query,
    q: asString(raw.q),
    start: asString(raw.start) || asString(raw.timeMin) || asString(raw.time_min),
    end: asString(raw.end) || asString(raw.timeMax) || asString(raw.time_max),
    raw,
  };
}

export async function handleJarvisTool(
  req: Request,
  run: (input: ToolInput) => Promise<unknown>,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const denied = rejectUnlessToolSecret(req);
  if (denied) return denied;

  let input: ToolInput;
  try {
    input = await parseToolInput(req);
  } catch {
    return speakableError("I could not read that request.");
  }

  try {
    const body = await run(input);
    return json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "bridge-store-unavailable") {
      return speakableError("The lookup bridge is not available right now.");
    }
    return speakableError("Something went wrong looking that up.");
  }
}
