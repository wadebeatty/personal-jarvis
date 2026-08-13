#!/usr/bin/env node
/**
 * Jarvis webhook tool schemas + optional later ElevenLabs workspace upsert.
 *
 * HOLD: do not register tools on the ElevenLabs agent yet. Toquer updates
 * prompt/walls from scripts/jarvis-tools.schema.json after Google readonly
 * OAuth + JARVIS_TOOL_SECRET are set on Netlify.
 *
 * Default (no flags): print webhook paths and request/response schemas. No API calls.
 *
 * Later, after Netlify env is live:
 *   node scripts/register-elevenlabs-tools.mjs --apply
 *     Creates/updates workspace secret + webhook tools only.
 *     Does NOT attach tool_ids to the agent and does NOT PATCH the prompt.
 *
 * There is no --attach-agent flag. Agent wiring stays with Toquer.
 *
 * Required for --apply:
 *   ELEVENLABS_API_KEY
 *   JARVIS_TOOL_SECRET   (must match Netlify)
 * Optional:
 *   JARVIS_TOOL_BASE_URL (default: https://personal-jarvis-813.netlify.app)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "https://personal-jarvis-813.netlify.app";
const API = "https://api.elevenlabs.io/v1";
const SECRET_NAME = "JARVIS_TOOL_SECRET";
const SCHEMA_PATH = join(ROOT, "scripts/jarvis-tools.schema.json");

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

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const apply = process.argv.includes("--apply");
const baseUrl = (process.env.JARVIS_TOOL_BASE_URL || schema.base_url || DEFAULT_BASE).replace(
  /\/$/,
  "",
);

function printHoldAndSchemas() {
  console.log(`HOLD: ${schema.hold}\n`);
  console.log("Webhook paths (POST, header X-Jarvis-Secret):\n");
  for (const tool of schema.tools) {
    console.log(`  ${tool.name}`);
    console.log(`    ${baseUrl}${tool.path}`);
    console.log(`    request:  ${JSON.stringify(tool.examples.request)}`);
    console.log(`    response: ${JSON.stringify(tool.examples.response)}\n`);
  }
  console.log("Full request/response schemas: scripts/jarvis-tools.schema.json");
  console.log("Draft prompt for Toquer (not applied): scripts/jarvis-system-prompt.txt");
  console.log("\nThis command made no ElevenLabs API calls.");
  console.log("After Google OAuth + JARVIS_TOOL_SECRET are on Netlify, Toquer can wire the agent.");
  console.log("Workspace-only upsert later: node scripts/register-elevenlabs-tools.mjs --apply");
}

if (!apply) {
  printHoldAndSchemas();
  process.exit(0);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const toolSecret = process.env.JARVIS_TOOL_SECRET;

if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY.");
  process.exit(1);
}
if (!toolSecret) {
  console.error("Set JARVIS_TOOL_SECRET (same value as the Netlify env var).");
  process.exit(1);
}

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
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }
  return json;
}

function toolConfig(tool, secretId) {
  const properties = {};
  for (const [key, spec] of Object.entries(tool.request.properties || {})) {
    properties[key] = { type: "string", description: spec.description || "" };
  }
  return {
    type: "webhook",
    name: tool.name,
    description: tool.description,
    response_timeout_secs: schema.elevenlabs_webhook_hints.response_timeout_secs,
    pre_tool_speech: schema.elevenlabs_webhook_hints.pre_tool_speech,
    execution_mode: schema.elevenlabs_webhook_hints.execution_mode,
    api_schema: {
      url: `${baseUrl}${tool.path}`,
      method: "POST",
      request_headers: {
        "Content-Type": "application/json",
        "X-Jarvis-Secret": { secret_id: secretId },
      },
      request_body_schema: {
        type: "object",
        description: "JSON body for this Jarvis lookup.",
        properties,
        required: tool.request.required || [],
      },
    },
  };
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
    console.log(`Updated workspace tool ${config.name} (${id}) — not attached to the agent`);
    return id;
  }
  const created = await api("POST", "/convai/tools", body);
  const id = toolId(created);
  if (!id) throw new Error(`Create ${config.name} did not return an id`);
  console.log(`Created workspace tool ${config.name} (${id}) — not attached to the agent`);
  return id;
}

console.log(
  "HOLD reminder: this upserts workspace tools only. It does not attach them to the Jarvis agent or change the prompt.\n",
);

const secretId = await upsertSecret();
for (const tool of schema.tools) {
  await upsertTool(toolConfig(tool, secretId));
}
console.log(
  "\nWorkspace tools ready. Toquer still needs to attach tool_ids and update prompt/walls on the agent.",
);
