# JARVIS — personal aide

Wade Beatty’s personal Jarvis voice webapp: a dark Iron Man–inspired HUD on Netlify, talking to an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/customization/widget) agent.

This is a **personal aide only** — not Western Pest, not ward ministry.

## What v1 does

- Single-page HUD (`public/`) with start / end conversation controls
- ElevenLabs widget via `@elevenlabs/convai-widget-embed` (unpkg)
- **Authenticated agent** (`enable_auth: true`) — the browser never gets `ELEVENLABS_API_KEY` and never embeds the public `agent-id` alone
- Netlify Function `GET /.netlify/functions/signed-url` mints a short-lived signed URL, then the HUD starts the widget with that URL

Out of scope for v1: tool calling, voice cloning, Western Pest, and ward ministry features.

## Architecture

```
Browser HUD  --GET-->  /.netlify/functions/signed-url
                              |
                              | xi-api-key (server env only)
                              v
                     ElevenLabs get-signed-url
                              |
                              v
Browser HUD  <-- { signedUrl } --
                              |
                              v
              <elevenlabs-convai signed-url="wss://...">
```

1. Wade taps **Initiate**.
2. The page calls `GET /.netlify/functions/signed-url`.
3. The function calls  
   `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…`  
   with header `xi-api-key` from `ELEVENLABS_API_KEY`.
4. The function returns JSON `{ "signedUrl": "wss://..." }` (camelCase for the client; ElevenLabs itself returns `signed_url`).
5. The HUD sets `signed-url` on the widget and calls `startConversation()`. Signed URLs last about **15 minutes** to *start* a session; an open conversation can continue after that.

Agent ID (fixed): `agent_0901kzw48twfeq4ar7jn0f87dx94`

## Local development

```bash
cp .env.example .env
# put a real ELEVENLABS_API_KEY in .env
npx netlify-cli dev
```

`netlify dev` serves `public/` and injects env vars into the function. Open the printed local URL (usually `http://localhost:8888`).

Microphone access needs a secure context (localhost or HTTPS).

```bash
npm test        # signed-url function unit tests (mocked ElevenLabs)
npm run typecheck
```

## Netlify deploy (team `wadebeatty`)

1. Create / link a site on the **wadebeatty** Netlify team from this repo.
2. Build settings are in `netlify.toml`:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
   - No frontend bundler
3. Site env vars (Site configuration → Environment variables), all contexts:

   | Variable | Value |
   | --- | --- |
   | `ELEVENLABS_API_KEY` | ElevenLabs API key (secret) |
   | `ELEVENLABS_AGENT_ID` | `agent_0901kzw48twfeq4ar7jn0f87dx94` |

4. Deploy. Production and Deploy Previews both need the same secrets so the signed-url function can run.

Do **not** prefix these with `VITE_` / `PUBLIC_` — they must stay server-side.

## Signed-url function

| | |
| --- | --- |
| Path | `GET /.netlify/functions/signed-url` |
| File | `netlify/functions/signed-url.ts` |
| Upstream | `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url` |
| Auth header | `xi-api-key: <ELEVENLABS_API_KEY>` |
| Success body | `{ "signedUrl": "wss://..." }` |
| Cache | `Cache-Control: no-store` |

The function reads env with `Netlify.env.get(...)`. It never returns the API key. Failures return a generic JSON `{ "error": "..." }` without upstream payloads.

## Widget

Loaded from:

```html
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed@0.15.1" async></script>
```

The `<elevenlabs-convai>` element is created **without** `agent-id`. After the signed URL is fetched, the HUD sets `signed-url` and starts the session. The default widget chrome is clipped so the HUD orb / buttons stay the UI.

## Repo layout

```
public/                 static HUD (publish directory)
  index.html
  css/styles.css
  js/app.js
netlify/functions/
  signed-url.ts         signed URL minting
netlify.toml
.env.example
```
