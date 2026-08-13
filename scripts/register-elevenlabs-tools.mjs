#!/usr/bin/env node
/**
 * Create/update Jarvis webhook tools in ElevenLabs and attach them to the
 * personal agent. Reads secrets from env — never hardcode them.
 *
 * Required env:
 *   ELEVENLABS_API_KEY
 *   JARVIS_TOOL_SECRET
 *
 * Optional:
 *   ELEVENLABS_AGENT_ID   (default: agent_0901kzw48twfeq4ar7jn0f87dx94)
 *   JARVIS_TOOL_BASE_URL  (default: https://personal-jarvis-813.netlify.app)
 *
 * Usage:
 *   node scripts/register-elevenlabs-tools.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_AGENT_ID = "agent_0901kzw48twfeq4ar7jn0f87dx94";
const DEFAULT_BASE = "https://personal-jarvis-813.netlify.app";
const API = "https://api.elevenlabs.io/v1";
const SECRET_NAME = "JARVIS_TOOL_SECRET";
const TOOL_NAMES = ["jarvis_calendar", "jarvis_email", "jarvis_contacts"];

function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const apiKey = process.env.ELEVENLABS_API_KEY;
const toolSecret = process.env.JARVIS_TOOL_SECRET;
const agentId = process.env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;
const baseUrl = (process.env.JARVIS_TOOL_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");

if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY.");
  process.exit(1);
}
if (!toolSecret) {
  console.error("Set JARVIS_TOOL_SECRET (same value as the Netlify env var).");
  process.exit(1);
}

const promptPath = join(ROOT, "scripts/jarvis-system-prompt.txt");
const systemPrompt = readFileSync(promptPath, "utf8").trim();

function headers() {
  return {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.detail || json?.error || json?.message || text.slice(0, 400);
    throw new Error(`${method} ${path} → ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return json;
}

function stringProp(description, required = false) {
  return { type: "string", description, ...(required ? {} : {}) };
}

function toolConfig(name, description, url, properties, required) {
  return {
    type: "webhook",
    name,
    description,
    response_timeout_secs: 30,
    pre_tool_speech: "force",
    execution_mode: "post_tool_speech",
    api_schema: {
      url,
      method: "POST",
      request_headers: {
        "Content-Type": "application/json",
        "X-Jarvis-Secret": { secret_id: secretId },
      },
      request_body_schema: {
        type: "object",
        description: "JSON body for this Jarvis lookup.",
        properties,
        required,
      },
    },
  };
}

let secretId = "";

function buildTools() {
  return [
    toolConfig(
      "jarvis_calendar",
      "Look up Wade Beatty’s personal Google Calendar (America/Denver). Use for schedule, meetings, what’s next, today, tomorrow, or a date range. Read-only. Pass a natural query such as 'tomorrow' or 'dentist', and optional start/end ISO-8601 datetimes.",
      `${baseUrl}/.netlify/functions/tools-calendar`,
      {
        query: stringProp(
          "Natural language calendar query, e.g. 'tomorrow', 'today', 'this week', or a topic like 'dentist'.",
        ),
        start: stringProp("Optional ISO-8601 start datetime (inclusive). Prefer America/Denver offsets."),
        end: stringProp("Optional ISO-8601 end datetime (exclusive). Prefer America/Denver offsets."),
      },
      [],
    ),
    toolConfig(
      "jarvis_email",
      "Search Wade Beatty’s Gmail (read-only). Use when he asks about recent mail, whether someone emailed him, or a subject. Returns from, subject, date, and a short snippet only. Never send mail.",
      `${baseUrl}/.netlify/functions/tools-email`,
      {
        query: stringProp(
          "Natural search such as 'from Sarah', 'unread', or a Gmail query like 'from:name@example.com newer_than:14d'.",
        ),
        q: stringProp("Optional explicit Gmail search string. If set, used as-is."),
      },
      [],
    ),
    toolConfig(
      "jarvis_contacts",
      "Search Wade Beatty’s Google Contacts by name, email, or phone. Read-only. Returns display name, emails, and phone numbers.",
      `${baseUrl}/.netlify/functions/tools-contacts`,
      {
        query: stringProp("Name, email, or phone to look up, e.g. 'Sarah' or '435-555-0100'."),
      },
      ["query"],
    ),
  ];
}

async function upsertSecret() {
  const listed = await api("GET", `/convai/secrets?search=${encodeURIComponent(SECRET_NAME)}`);
  const secrets = listed?.secrets || listed || [];
  const existing = (Array.isArray(secrets) ? secrets : []).find((s) => s.name === SECRET_NAME);
  if (existing?.secret_id) {
    await api("PATCH", `/convai/secrets/${existing.secret_id}`, {
      type: "update",
      name: SECRET_NAME,
      value: toolSecret,
    });
    console.log(`Updated workspace secret ${SECRET_NAME} (${existing.secret_id})`);
    return existing.secret_id;
  }
  const created = await api("POST", "/convai/secrets", {
    type: "new",
    name: SECRET_NAME,
    value: toolSecret,
  });
  if (!created?.secret_id) {
    throw new Error("ElevenLabs did not return a secret_id");
  }
  console.log(`Created workspace secret ${SECRET_NAME} (${created.secret_id})`);
  return created.secret_id;
}

async function listToolsByName(name) {
  const listed = await api("GET", `/convai/tools?search=${encodeURIComponent(name)}`);
  const tools = listed?.tools || [];
  return tools.filter((t) => t.tool_config?.name === name || t.name === name);
}

function toolId(record) {
  return record.id || record.tool_id || record.toolId;
}

async function upsertTool(config) {
  const matches = await listToolsByName(config.name);
  const existing = matches[0];
  const body = { tool_config: config };
  if (existing && toolId(existing)) {
    const id = toolId(existing);
    await api("PATCH", `/convai/tools/${id}`, body);
    console.log(`Updated tool ${config.name} (${id})`);
    return id;
  }
  const created = await api("POST", "/convai/tools", body);
  const id = toolId(created);
  if (!id) throw new Error(`Create ${config.name} did not return an id`);
  console.log(`Created tool ${config.name} (${id})`);
  return id;
}

async function attachToAgent(toolIds) {
  const agent = await api("GET", `/convai/agents/${agentId}`);
  const currentIds = agent?.conversation_config?.agent?.prompt?.tool_ids || [];
  const listed = await api("GET", "/convai/tools?search=jarvis_");
  const jarvisIds = new Set(
    (listed?.tools || [])
      .filter((t) => TOOL_NAMES.includes(t.tool_config?.name || t.name))
      .map(toolId)
      .filter(Boolean),
  );
  const unique = [...new Set([...currentIds.filter((id) => !jarvisIds.has(id)), ...toolIds])];

  await api("PATCH", `/convai/agents/${agentId}`, {
    conversation_config: {
      agent: {
        prompt: {
          prompt: systemPrompt,
          tool_ids: unique,
          timezone: "America/Denver",
        },
      },
    },
  });
  console.log(`Updated agent ${agentId} with ${unique.length} tool_id(s) and the Jarvis system prompt.`);
}

secretId = await upsertSecret();
const ids = [];
for (const config of buildTools()) {
  ids.push(await upsertTool(config));
}
await attachToAgent(ids);
console.log("\nDone. Voice-test: “What’s on my calendar tomorrow?” and “Any email from …?”");
