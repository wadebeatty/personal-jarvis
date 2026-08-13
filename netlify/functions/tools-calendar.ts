import type { Config } from "@netlify/functions";
import { handleJarvisTool } from "./_shared/http.ts";
import { enqueueAndWait } from "./_shared/bridge.ts";

export default async (req: Request) =>
  handleJarvisTool(req, (input) => enqueueAndWait("calendar", input));

export const config: Config = {
  method: ["POST"],
};
