import type { Config } from "@netlify/functions";
import { handleJarvisTool } from "./_shared/http.ts";
import { searchContacts } from "./_shared/contacts.ts";

export default async (req: Request) =>
  handleJarvisTool(req, (input) => searchContacts(input));

export const config: Config = {
  method: ["POST"],
};
