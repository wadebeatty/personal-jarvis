# JARVIS — personal aide

Wade Beatty’s personal Jarvis voice webapp: a dark Iron Man–inspired HUD on Netlify, talking to an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/libraries/java-script) agent via the **Client SDK**.

This is a **personal aide only** — not Western Pest, not ward ministry.

## What v1 does

- Single-page HUD (`public/`) with Initiate / End conversation controls
- Voice session via [`@elevenlabs/client`](https://www.npmjs.com/package/@elevenlabs/client) (CDN browser bundle)
- **Authenticated agent** (`enable_auth: true`) — the browser never gets `ELEVENLABS_API_KEY` and never embeds the public `agent-id`
- Netlify Function `GET /.netlify/functions/signed-url` mints a short-lived signed URL, then the HUD calls `Conversation.startSession({ signedUrl })`

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
         Conversation.startSession({ signedUrl, connectionType: "websocket" })
                              |
                              v
                    mic capture + agent audio playback
```

1. Wade taps **Initiate**.
2. The page requests microphone permission, then calls `GET /.netlify/functions/signed-url`.
3. The function calls  
   `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…`  
   with header `xi-api-key` from `ELEVENLABS_API_KEY`.
4. The function returns JSON `{ "signedUrl": "wss://..." }` (camelCase for the client; ElevenLabs itself returns `signed_url`).
5. The HUD starts a real Client SDK session with that URL. HUD **ONLINE** is set only after `startSession` connects (`onConnect`). Signed URLs last about **15 minutes** to *start* a session; an open conversation can continue after that.
6. **End** calls `conversation.endSession()` and returns the HUD to STANDBY.

The public embed widget (`@elevenlabs/convai-widget-embed`) is **not** used. Authenticated agents need the Client SDK; the widget also does not expose `startConversation` / `endConversation`, so a clipped embed would never start a session.

Agent ID (server-only, via env / function default): `agent_0901kzw48twfeq4ar7jn0f87dx94`

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

## Voice client

Loaded from a pinned CDN browser bundle (IIFE). This is the `@elevenlabs/client` **browser** entry — it registers microphone capture and audio playback. A bare ESM import of the package default export does **not** register those and cannot start a voice session.

```html
<script src="https://unpkg.com/@elevenlabs/client@1.17.0/dist/lib.iife.js" defer></script>
```

`public/js/app.js` then uses `ElevenLabsClient.Conversation.startSession({ signedUrl, connectionType: "websocket" })`.

HUD states track the real session:

| State | Label | When |
| --- | --- | --- |
| connecting | AUTHORIZING / CONNECTING | mic + signed URL + websocket handshake |
| listening | ONLINE | session started, agent listening |
| speaking | SPEAKING | agent audio playing |
| ended | STANDBY | `endSession` or agent hangup |
| error | FAULT | start failure or unexpected disconnect |

Do not set `agent-id` in the page. The signed URL already authorizes this private agent.

## Manual voice check

On the deployed site (HTTPS):

1. Click **Initiate** and allow the microphone.
2. HUD should move AUTHORIZING → CONNECTING → **ONLINE** (not ONLINE before the session exists).
3. Hear Jarvis’s first spoken message (orb **SPEAKING**).
4. Talk; hear a reply.
5. Click **End conversation** → STANDBY.
6. ElevenLabs conversation history for the agent should show a new session (not stay at 0).

## Repo layout

```
public/                 static HUD (publish directory)
  index.html
  css/styles.css
  js/app.js
netlify/functions/
  signed-url.ts         signed URL minting
tests/
  signed-url.test.ts
netlify.toml
.env.example
```
