# JARVIS — personal aide

Wade Beatty’s personal Jarvis voice webapp: a dark Iron Man–inspired HUD on Netlify, talking to an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/libraries/java-script) agent via the **Client SDK**.

This is a **personal aide only** — not Western Pest, not ward ministry.

## What it does

- Single-page HUD (`public/`) with Initiate / End conversation controls
- Voice session via [`@elevenlabs/client`](https://www.npmjs.com/package/@elevenlabs/client) (CDN browser bundle)
- **Authenticated agent** (`enable_auth: true`) — the browser never gets `ELEVENLABS_API_KEY` and never embeds the public `agent-id`
- Netlify Function `GET /.netlify/functions/signed-url` mints a short-lived signed URL, then the HUD calls `Conversation.startSession({ signedUrl })`
- **Read-only brain tools (not attached to the agent yet)**: Netlify webhooks enqueue calendar/email jobs; Toquer/Forge fulfills them via Grok Bot MCP (user-Google-calendar + user-Gmail). Contacts v1 returns a speakable unavailable line (no Contacts MCP). Webhook paths and schemas are in `scripts/jarvis-tools.schema.json`. **Hold ElevenLabs registration** until `JARVIS_TOOL_SECRET` is set and the fulfill agent is polling. **GOOGLE_* is not required on Netlify.** No send-mail, no calendar writes, no SMS.

Out of scope: voice cloning, Western Pest operations, and ward ministry / Steward workflows.

## Walls

| Jarvis **will** | Jarvis **will not** |
| --- | --- |
| Answer factual questions from Wade’s calendar and inbox | Run Western Pest business ops (jobs, Cleo, dispatch, quotes) |
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
                              |  (ElevenLabs server webhook, not the browser)
                              v
         POST /.netlify/functions/tools-calendar|email
              header X-Jarvis-Secret: JARVIS_TOOL_SECRET
                              |
                              |  enqueue job in Netlify Blobs (pending)
                              |  poll ~18s for status=done
                              v
         GET  /.netlify/functions/bridge-pending     (Toquer/Forge)
         POST /.netlify/functions/bridge-complete    { id, ok, summary, events|messages }
                              |
                              v
         Grok Bot MCP: user-Google-calendar + user-Gmail
         (Google credentials stay on the fulfill agent — not on Netlify)
```

Contacts (`tools-contacts`) keep the same webhook path but **do not enqueue**. They return `{ ok: false, summary: "Contacts aren’t on a Grok Bot connector yet — ask about email or calendar instead." }`.

1. Wade taps **Initiate**.
2. The page requests microphone permission, then calls `GET /.netlify/functions/signed-url`.
3. The function calls  
   `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…`  
   with header `xi-api-key` from `ELEVENLABS_API_KEY`.
4. The function returns JSON `{ "signedUrl": "wss://..." }` (camelCase for the client; ElevenLabs itself returns `signed_url`).
5. The HUD starts a real Client SDK session with that URL. HUD **ONLINE** is set only after `startSession` connects (`onConnect`). Signed URLs last about **15 minutes** to *start* a session; an open conversation can continue after that.
6. **Later (after `JARVIS_TOOL_SECRET` is on Netlify, the fulfill agent is polling, and Toquer attaches the tools):** if Wade asks about schedule / inbox, the agent says a brief “let me check”, then ElevenLabs POSTs JSON to `tools-calendar` or `tools-email` with `X-Jarvis-Secret`. The function stores a pending job in Netlify Blobs and waits up to ~18s. Toquer/Forge lists jobs on `bridge-pending`, fulfills via Grok Bot MCP, and POSTs `bridge-complete`. Until tools are attached, the HUD still talks.
7. **End** calls `conversation.endSession()` and returns the HUD to STANDBY.

The public embed widget (`@elevenlabs/convai-widget-embed`) is **not** used. Authenticated agents need the Client SDK; the widget also does not expose `startConversation` / `endConversation`, so a clipped embed would never start a session.

Agent ID (server-only, via env / function default): `agent_0901kzw48twfeq4ar7jn0f87dx94`

## Local development

```bash
cp .env.example .env
# put real ELEVENLABS_API_KEY (and JARVIS_TOOL_SECRET to hit tools locally)
npx netlify-cli dev
```

`netlify dev` serves `public/` and injects env vars into the function. Open the printed local URL (usually `http://localhost:8888`).

Microphone access needs a secure context (localhost or HTTPS).

```bash
npm test        # unit tests (mocked ElevenLabs + Blobs bridge)
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
   | `JARVIS_TOOL_SECRET` | Long random string; ElevenLabs and the fulfill agent send this as `X-Jarvis-Secret` |

   Do **not** set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REFRESH_TOKEN` on Netlify. Calendar/email access lives on Toquer/Forge via Grok Bot MCP.

4. Deploy. Production and Deploy Previews both need the same secrets so signed-url and the bridge can run.
5. **Hold ElevenLabs tool registration** until `JARVIS_TOOL_SECRET` is set and Toquer/Forge is polling `bridge-pending`. Toquer then updates the Jarvis prompt/walls and attaches tools using `scripts/jarvis-tools.schema.json`.

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

## Brain tools (read-only) — connector-bridge, not on the agent yet

Calendar and email are `POST` JSON, protected by header `X-Jarvis-Secret` matching `JARVIS_TOOL_SECRET`. They **do not call Google from Netlify**. Each request creates a Blobs job, polls until `status === "done"` (or ~18s timeout), and returns short speakable JSON (no HTML), capped at **5** items. Timezone: **America/Denver**.

Canonical paths + request/response schemas: **`scripts/jarvis-tools.schema.json`**. Draft prompt/walls for Toquer: **`scripts/jarvis-system-prompt.txt`** (not applied to the agent by this repo).

| Tool name | Webhook path | Absolute URL |
| --- | --- | --- |
| `jarvis_calendar` | `/.netlify/functions/tools-calendar` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-calendar` |
| `jarvis_email` | `/.netlify/functions/tools-email` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-email` |
| `jarvis_contacts` | `/.netlify/functions/tools-contacts` | `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-contacts` |

Auth: `POST` + `Content-Type: application/json` + `X-Jarvis-Secret: <JARVIS_TOOL_SECRET>`. Missing/wrong secret → `401 { "error": "Unauthorized" }`. Poll timeout → `200 { "ok": false, "summary": "I couldn’t check your calendar in time. Try again in a moment." }`.

Do **not** copy Western/Cleo tool URLs or secrets. Steward keeps the pastoral lane.

### Fulfill agent (Toquer/Forge)

Same secret header. Google credentials stay on Grok Bot MCP, not Netlify.

| Endpoint | Method | Path |
| --- | --- | --- |
| List pending jobs (max 10, oldest first) | `GET` | `/.netlify/functions/bridge-pending` |
| Mark done + store speakable result | `POST` | `/.netlify/functions/bridge-complete` |

`bridge-complete` body:

```json
{
  "id": "<job uuid>",
  "ok": true,
  "summary": "2 events tomorrow.",
  "events": [
    { "when": "Friday, August 14 9:00 AM to 9:30 AM", "title": "Standup", "where": "Zoom" }
  ]
}
```

Use `messages` instead of `events` for email jobs. The poller returns that payload to ElevenLabs.

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

**Contacts** `POST /.netlify/functions/tools-contacts` (v1: no enqueue)

Request:

```json
{ "query": "Pat Lee" }
```

Response:

```json
{
  "ok": false,
  "summary": "Contacts aren’t on a Grok Bot connector yet — ask about email or calendar instead."
}
```

Shared helpers live in `netlify/functions/_shared/` (underscore prefix so Netlify does not deploy them as functions).

### ElevenLabs registration — HOLD

Do **not** attach tools to agent `agent_0901kzw48twfeq4ar7jn0f87dx94` until:

1. `JARVIS_TOOL_SECRET` is on Netlify
2. The `tools-*` and `bridge-*` functions are deployed
3. Toquer/Forge is polling `bridge-pending` and completing jobs via Grok Bot MCP

`GOOGLE_*` is **not** required on Netlify.

Toquer owns prompt/walls updates (remove “no external tools yet”; keep Western redirect; Steward keeps pastoral care; allow factual calendar/email answers). Use `scripts/jarvis-tools.schema.json` and the draft in `scripts/jarvis-system-prompt.txt`.

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

**Functions (no ElevenLabs agent wiring required).** Use two terminals so the fulfill step can complete the in-flight calendar request:

```bash
# Terminal A — this blocks ~18s until complete (or times out)
curl -sS -X POST "$URL/.netlify/functions/tools-calendar" \
  -H "Content-Type: application/json" \
  -H "X-Jarvis-Secret: $JARVIS_TOOL_SECRET" \
  -d '{"query":"tomorrow"}'

# Terminal B — job should appear
curl -sS "$URL/.netlify/functions/bridge-pending" \
  -H "X-Jarvis-Secret: $JARVIS_TOOL_SECRET"

# Terminal B — complete with a fake summary (copy id from pending)
curl -sS -X POST "$URL/.netlify/functions/bridge-complete" \
  -H "Content-Type: application/json" \
  -H "X-Jarvis-Secret: $JARVIS_TOOL_SECRET" \
  -d '{"id":"<job-id>","ok":true,"summary":"2 events tomorrow.","events":[{"when":"Friday, August 14 9:00 AM to 9:30 AM","title":"Standup","where":"Zoom"}]}'
```

Smoke:

- With secret: `POST tools-calendar` creates a job visible on `GET bridge-pending`
- `POST bridge-complete` with a fake summary → the waiting `tools-calendar` request returns that summary
- Without secret → `401`

Contacts with secret returns `{ "ok": false, "summary": "Contacts aren’t on a Grok Bot connector yet — ask about email or calendar instead." }` and does not create a pending job.

**Voice (after Toquer attaches tools and the fulfill agent is polling):**

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
  tools-calendar.ts     enqueue + poll Blobs
  tools-email.ts        enqueue + poll Blobs
  tools-contacts.ts     sync unavailable (no enqueue)
  bridge-pending.ts     GET pending jobs for fulfill agent
  bridge-complete.ts    POST result the poller waits on
  _shared/              auth, Blobs bridge, speakable shaping
scripts/
  register-elevenlabs-tools.mjs   # default: print schemas; --apply later, no agent attach
  jarvis-tools.schema.json        # webhook paths + request/response for Toquer
  jarvis-system-prompt.txt        # draft prompt/walls; not auto-applied
tests/
netlify.toml
.env.example
```
