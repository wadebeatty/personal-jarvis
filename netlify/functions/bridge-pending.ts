import type { Config } from "@netlify/functions";
import { json, rejectUnlessToolSecret } from "./_shared/http.ts";
import { listPendingJobs } from "./_shared/bridge.ts";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const denied = rejectUnlessToolSecret(req);
  if (denied) return denied;

  try {
    const jobs = await listPendingJobs(10);
    return json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "bridge-store-unavailable") {
      return json({ error: "Bridge store is not available" }, 500);
    }
    return json({ error: "Something went wrong listing jobs" }, 500);
  }
};

export const config: Config = {
  method: ["GET"],
};
