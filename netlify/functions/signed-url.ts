import type { Config } from "@netlify/functions";

const DEFAULT_AGENT_ID = "agent_0901kzw48twfeq4ar7jn0f87dx94";
const ELEVENLABS_SIGNED_URL =
  "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function env(name: string): string | undefined {
  return Netlify.env.get(name);
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = env("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return json(
      { error: "Server is missing ELEVENLABS_API_KEY" },
      500,
    );
  }

  const agentId = env("ELEVENLABS_AGENT_ID") || DEFAULT_AGENT_ID;
  const url = new URL(ELEVENLABS_SIGNED_URL);
  url.searchParams.set("agent_id", agentId);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "xi-api-key": apiKey,
      },
    });
  } catch {
    return json({ error: "Unable to reach ElevenLabs" }, 502);
  }

  if (!upstream.ok) {
    return json(
      { error: "Failed to create a signed conversation URL" },
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
    );
  }

  let payload: { signed_url?: string; signedUrl?: string };
  try {
    payload = (await upstream.json()) as {
      signed_url?: string;
      signedUrl?: string;
    };
  } catch {
    return json({ error: "Unexpected response from ElevenLabs" }, 502);
  }

  const signedUrl = payload.signed_url || payload.signedUrl;
  if (!signedUrl) {
    return json({ error: "ElevenLabs did not return a signed URL" }, 502);
  }

  return json({ signedUrl });
};

export const config: Config = {
  method: ["GET"],
};
