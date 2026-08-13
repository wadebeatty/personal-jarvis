# JARVIS — personal aide

Wade Beatty’s personal Jarvis voice webapp: a dark Iron Man–inspired HUD on Netlify, talking to an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/libraries/java-script) agent via the **Client SDK**.

This is a **personal aide only** — not Western Pest, not ward ministry.

## What it does

- Single-page HUD (`public/`) with Initiate / End conversation controls
- Voice session via [`@elevenlabs/client`](https://www.npmjs.com/package/@elevenlabs/client) (CDN browser bundle)
- **Authenticated agent** (`enable_auth: true`) — the browser never gets `ELEVENLABS_API_KEY` and never embeds the public `agent-id`
- Netlify Function `GET /.netlify/functions/signed-url` mints a short-lived signed URL, then the HUD calls `Conversation.startSession({ signedUrl })`
- **Read-only brain tools (scaffolded, not attached to the agent yet)**: Netlify functions for Google Calendar, Gmail, and Contacts. Webhook paths and schemas are in `scripts/jarvis-tools.schema.json` for Toquer. **Hold ElevenLabs registration** until Google readonly OAuth + `JARVIS_TOOL_SECRET` are set on Netlify. No send-mail, no calendar writes, no SMS.

Out of scope: voice cloning, Western Pest operations, and ward ministry / Steward workflows.

## Walls

| Jarvis **will** | Jarvis **will not** |
| --- | --- |
| Answer factual questions from Wade’s calendar, inbox, and contacts | Run Western Pest business ops (jobs, Cleo, dispatch, quotes) |
| Report a ward meeting if it appears on his personal calendar (facts only) | Do Bishop/ward pastoral care, calling assignments, counseling, or ministry workflow (that stays **Steward**) |
| Look things up (read-only) | Send email, create/modify calendar events, or text |

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
                              |
                              |  (ElevenLabs server webhook, not the browser)
                              v
         POST /.netlify/functions/tools-calendar|email|contacts
              header X-Jarvis-Secret: JARVIS_TOOL_SECRET
                              |
                              v
                    Google APIs (calendar.readonly, gmail.readonly, contacts.readonly)
```

1. Wade taps **Initiate**.
2. The page requests microphone permission, then calls `GET /.netlify/functions/signed-url`.
3. The function calls  
   `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…`  
   with header `xi-api-key` from `ELEVENLABS_API_KEY`.
4. The function returns JSON `{ "signedUrl": "wss://..." }` (camelCase for the client; ElevenLabs itself returns `signed_url`).
5. The HUD starts a real Client SDK session with that URL. HUD **ONLINE** is set only after `startSession` connects (`onConnect`). Signed URLs last about **15 minutes** to *start* a session; an open conversation can continue after that.
6. **Later (after Google env + `JARVIS_TOOL_SECRET` are on Netlify, and Toquer attaches the tools):** if Wade asks about schedule / inbox / people, the agent says a brief “let me check”, then ElevenLabs POSTs JSON to the matching tool function with `X-Jarvis-Secret`. Until then, the HUD still talks; tools are not on the agent.
7. **End** calls `conversation.endSession()` and returns the HUD to STANDBY.

The public embed widget (`@elevenlabs/convai-widget-embed`) is **not** used. Authenticated agents need the Client SDK; the widget also does not expose `startConversation` / `endConversation`, so a clipped embed would never start a session.

Agent ID (server-only, via env / function default): `agent_0901kzw48twfeq4ar7jn0f87dx94`

## Local development

```bash
cp .env.example .env
# put real ELEVENLABS_API_KEY (and tool/Google vars if you want to hit tools locally)
npx netlify-cli dev
```

`netlify dev` serves `public/` and injects env vars into the function. Open the printed local URL (usually `http://localhost:8888`).

Microphone access needs a secure context (localhost or HTTPS).

```bash
npm test        # unit tests (mocked ElevenLabs + Google)
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
   | `JARVIS_TOOL_SECRET` | Long random string; ElevenLabs will send this as `X-Jarvis-Secret` once tools are registered |
   | `GOOGLE_CLIENT_ID` | OAuth Desktop client ID |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret |
   | `GOOGLE_REFRESH_TOKEN` | From `scripts/google-oauth-setup.mjs` (or Playground with **your** client) |

4. Deploy. Production and Deploy Previews both need the same secrets so signed-url and tools can run.
5. **Hold ElevenLabs tool registration** until `GOOGLE_*` readonly OAuth and `JARVIS_TOOL_SECRET` are set on this site. Toquer then updates the Jarvis prompt/walls and attaches tools using `scripts/jarvis-tools.schema.json`.

Do **not** prefix these with `VITE_` / `PUBLIC_` — they must stay server-side. Never commit refresh tokens, API keys, or `JARVIS_TOOL_SECRET`.

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

## Brain tools (read-only) — scaffolded, not on the agent yet

All three are `POST` JSON, protected by header `X-Jarvis-Secret` matching `JARVIS_TOOL_SECRET`. Responses are short, speakable JSON (no HTML), capped at **5** items. Timezone: **America/Denver**.

Canonical paths + request/response schemas: **`scripts/jarvis-tools.schema.json`**. Draft prompt/walls for Toquer: **`scripts/jarvis-system-prompt.txt`** (not applied to the agent by this repo).

| Tool name | Webhook path | Absolute URL |
| --- | --- | --- |
| `jarvis_calendar` | `/.netlify/functions/tools-calendar` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-calendar` |
| `jarvis_email` | `/.netlify/functions/tools-email` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-email` |
| `jarvis_contacts` | `/.netlify/functions/tools-contacts` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-contacts` |

Auth: `POST` + `Content-Type: application/json` + `X-Jarvis-Secret: <JARVIS_TOOL_SECRET>`. Missing/wrong secret → `401 { "error": "Unauthorized" }`. Google env missing → `200 { "ok": false, "summary": "Google access is not configured yet." }`.

Do **not** copy Western/Cleo tool URLs or secrets. Steward keeps the pastoral lane.

### Request / response schemas

**Calendar** `POST /.netlify/functions/tools-calendar`

Request:

```json
{ "query": "tomorrow", "start": "optional ISO-8601", "end": "optional ISO-8601" }
```

Response:

```json
{
  "ok": true,
  "summary": "2 events tomorrow.",
  "events": [
    { "when": "Friday, August 14 9:00 AM to 9:30 AM", "title": "Standup", "where": "Zoom" }
  ]
}
```

**Email** `POST /.netlify/functions/tools-email`

Request:

```json
{ "query": "any email from Sarah", "q": "optional raw Gmail query" }
```

Response:

```json
{
  "ok": true,
  "summary": "1 message.",
  "messages": [
    { "from": "Sarah Connor", "subject": "Invoice", "date": "Thursday, August 13 at 12:00 PM", "snippet": "Please see the invoice attached." }
  ]
}
```

**Contacts** `POST /.netlify/functions/tools-contacts`

Request:

```json
{ "query": "Pat Lee" }
```

Response:

```json
{
  "ok": true,
  "summary": "1 contact.",
  "contacts": [
    { "name": "Pat Lee", "emails": ["pat@example.com"], "phones": ["+1 435-555-0100"] }
  ]
}
```

Shared helpers live in `netlify/functions/_shared/` (underscore prefix so Netlify does not deploy them as functions).

### Google OAuth (one-time, manual) — required before agent registration

Readonly scopes:

- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/contacts.readonly`

**Option A — local script (preferred on Wade’s Mac)**

1. Google Cloud Console → enable **Calendar API**, **Gmail API**, **People API**.
2. OAuth consent screen; add Wade as a test user if the app is in Testing.
3. Create an OAuth client ID of type **Desktop app**.
4. Add redirect URI `http://127.0.0.1:8765/oauth2callback`.
5. From this repo:

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth-setup.mjs
```

The script opens a browser, waits for the redirect, and prints `GOOGLE_REFRESH_TOKEN`. Paste client id, secret, and refresh token into Netlify env. Do not commit them.

If the local listener is awkward, use `--paste` and paste the `code` query param from the redirect URL.

**Option B — OAuth Playground**

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Gear icon → **Use your own OAuth credentials** (the default Playground client’s refresh tokens expire in ~24h).
3. Authorize the three readonly scopes above, then Exchange authorization code for tokens.
4. Copy the refresh token into `GOOGLE_REFRESH_TOKEN`.

This step is required and is not run in CI.

### ElevenLabs registration — HOLD

Do **not** attach tools to agent `agent_0901kzw48twfeq4ar7jn0f87dx94` until:

1. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` are on Netlify
2. `JARVIS_TOOL_SECRET` is on Netlify
3. The three `tools-*` functions are deployed

Toquer owns prompt/walls updates (remove “no external tools yet”; keep Western redirect; Steward keeps pastoral care; allow factual calendar/email/contact answers). Use `scripts/jarvis-tools.schema.json` and the draft in `scripts/jarvis-system-prompt.txt`.

```bash
npm run tools:schema    # prints paths + example JSON; no ElevenLabs API calls
```

`scripts/register-elevenlabs-tools.mjs --apply` is a **later** workspace-only upsert (secret + webhook tools). It does **not** attach `tool_ids` to the agent and does **not** PATCH the prompt. There is no attach-agent flag.

Optional: `JARVIS_TOOL_BASE_URL` if `--apply` should target a preview deploy.

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

Do not set `agent-id` in the page. The signed URL already authorizes this private agent. Tool calls never go through the browser.

## Manual checks

**Functions (no ElevenLabs agent wiring required):**

```bash
curl -sS -X POST "$URL/.netlify/functions/tools-calendar" \
  -H "Content-Type: application/json" \
  -H "X-Jarvis-Secret: $JARVIS_TOOL_SECRET" \
  -d '{"query":"tomorrow"}'
```

Wrong or missing secret must return `401`. With Google env unset, body is `{ "ok": false, "summary": "Google access is not configured yet." }`.

**Voice (after Toquer attaches tools and Google env is live):**

1. Click **Initiate** and allow the microphone.
2. HUD should move AUTHORIZING → CONNECTING → **ONLINE**.
3. Ask: **“What’s on my calendar tomorrow?”** — brief “let me check”, then events (or none).
4. Ask: **“Any email from [someone in your inbox]?”**
5. Ask something Western-ops or ward-pastoral — redirect to Western / Cleo or Steward; do not call those systems.
6. Click **End conversation** → STANDBY.

## Repo layout

```
public/                 static HUD (publish directory)
  index.html
  css/styles.css
  js/app.js
netlify/functions/
  signed-url.ts         signed URL minting
  tools-calendar.ts
  tools-email.ts
  tools-contacts.ts
  _shared/              auth, Google, speakable shaping
scripts/
  google-oauth-setup.mjs
  register-elevenlabs-tools.mjs   # default: print schemas; --apply later, no agent attach
  jarvis-tools.schema.json        # webhook paths + request/response for Toquer
  jarvis-system-prompt.txt        # draft prompt/walls; not auto-applied
tests/
netlify.toml
.env.example
```
