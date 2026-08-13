import type { Config } from "@netlify/functions";
import { json, rejectUnlessToolSecret } from "./_shared/http.ts";
import { completeBridgeJob, parseCompleteBody } from "./_shared/bridge.ts";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const denied = rejectUnlessToolSecret(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parseCompleteBody(body);
  if (!parsed) {
    return json({ error: "Invalid JSON" }, 400);
  }

  try {
    const result = await completeBridgeJob(parsed);
    if ("error" in result) {
      return json({ error: result.error }, result.status);
    }
    return json({ ok: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "bridge-store-unavailable") {
      return json({ error: "Bridge store is not available" }, 500);
    }
    return json({ error: "Something went wrong completing the job" }, 500);
  }
};

export const config: Config = {
  method: ["POST"],
};
