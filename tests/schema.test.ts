import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const schema = JSON.parse(readFileSync(new URL("../scripts/jarvis-tools.schema.json", import.meta.url), "utf8"));

test("jarvis-tools.schema.json documents three read-only webhook paths", () => {
  assert.equal(schema.read_only, true);
  assert.equal(schema.method, "POST");
  assert.equal(schema.auth.header, "X-Jarvis-Secret");
  assert.equal(schema.tools.length, 3);
  assert.deepEqual(
    schema.tools.map((t) => t.path),
    [
      "/.netlify/functions/tools-calendar",
      "/.netlify/functions/tools-email",
      "/.netlify/functions/tools-contacts",
    ],
  );
  for (const tool of schema.tools) {
    assert.match(tool.url, /^https:\/\/personal-jarvis-813\.netlify\.app\/\.netlify\/functions\/tools-/);
    assert.ok(tool.request.properties);
    assert.ok(tool.response.ok);
    assert.ok(tool.examples.request);
    if (tool.name === "jarvis_contacts") {
      assert.equal(tool.examples.response.ok, false);
      assert.match(tool.examples.response.summary, /Grok Bot connector/);
    } else {
      assert.equal(tool.examples.response.ok, true);
    }
  }
  assert.match(schema.hold, /JARVIS_TOOL_SECRET/);
  assert.match(schema.hold, /not required/);
  assert.equal(schema.bridge.google_env_on_netlify, false);
  assert.equal(schema.bridge.pending.path, "/.netlify/functions/bridge-pending");
  assert.equal(schema.bridge.complete.path, "/.netlify/functions/bridge-complete");
  assert.match(schema.walls.is_not.join(" "), /Western Pest/);
  assert.match(schema.walls.is_not.join(" "), /Steward/);
});

test("register script prints schemas and does not call ElevenLabs without --apply", () => {
  const result = spawnSync(process.execPath, ["scripts/register-elevenlabs-tools.mjs"], {
    encoding: "utf8",
    env: { ...process.env, ELEVENLABS_API_KEY: "should-not-be-used" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /HOLD/);
  assert.match(result.stdout, /no ElevenLabs API calls/);
  assert.match(result.stdout, /tools-calendar/);
  assert.match(result.stdout, /tools-email/);
  assert.match(result.stdout, /tools-contacts/);
  assert.equal(result.stdout.includes("Created workspace"), false);
});
