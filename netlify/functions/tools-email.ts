import type { Config } from "@netlify/functions";
import { handleJarvisTool } from "./_shared/http.ts";
import { searchEmail } from "./_shared/email.ts";

export default async (req: Request) =>
  handleJarvisTool(req, (input) => searchEmail(input));

export const config: Config = {
  method: ["POST"],
};
