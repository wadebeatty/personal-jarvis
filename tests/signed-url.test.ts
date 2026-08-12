import { test } from "node:test";
import assert from "node:assert/strict";

type EnvMap = Record<string, string | undefined>;

function installEnv(map: EnvMap) {
  (globalThis as { Netlify?: { env: { get(name: string): string | undefined } } }).Netlify = {
    env: {
      get(name: string) {
        return map[name];
      },
    },
  };
}

test("signed-url function mints camelCase JSON and never echoes the API key", async (t) => {
  installEnv({
    ELEVENLABS_API_KEY: "secret-key-must-not-leak",
    ELEVENLABS_AGENT_ID: "agent_0901kzw48twfeq4ar7jn0f87dx94",
  });

  const seen: { url?: string; apiKey?: string } = {};
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.apiKey = new Headers(init?.headers).get("xi-api-key") ?? undefined;
    return new Response(
      JSON.stringify({
        signed_url:
          "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_0901kzw48twfeq4ar7jn0f87dx94&conversation_signature=tok",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const { default: handler } = await import("../netlify/functions/signed-url.ts");
  const response = await handler(
    new Request("https://example.com/.netlify/functions/signed-url"),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    seen.url,
    "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_0901kzw48twfeq4ar7jn0f87dx94",
  );
  assert.equal(seen.apiKey, "secret-key-must-not-leak");
  assert.equal(
    body.signedUrl,
    "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_0901kzw48twfeq4ar7jn0f87dx94&conversation_signature=tok",
  );
  assert.equal(JSON.stringify(body).includes("secret-key-must-not-leak"), false);
});

test("signed-url function rejects non-GET and missing API key", async () => {
  installEnv({});
  const { default: handler } = await import("../netlify/functions/signed-url.ts");

  const method = await handler(
    new Request("https://example.com/.netlify/functions/signed-url", {
      method: "POST",
    }),
  );
  assert.equal(method.status, 405);

  const missing = await handler(
    new Request("https://example.com/.netlify/functions/signed-url"),
  );
  const missingBody = await missing.json();
  assert.equal(missing.status, 500);
  assert.equal(missingBody.error, "Server is missing ELEVENLABS_API_KEY");
});
