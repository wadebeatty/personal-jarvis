import type { Config } from "@netlify/functions";
import { handleJarvisTool } from "./_shared/http.ts";
import { searchCalendar } from "./_shared/calendar.ts";

export default async (req: Request) =>
  handleJarvisTool(req, (input) => searchCalendar(input));

export const config: Config = {
  method: ["POST"],
};
