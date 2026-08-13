import type { Config } from "@netlify/functions";
import { handleJarvisTool } from "./_shared/http.ts";
import { contactsUnavailable } from "./_shared/contacts.ts";

export default async (req: Request) =>
  handleJarvisTool(req, async () => contactsUnavailable());

export const config: Config = {
  method: ["POST"],
};
