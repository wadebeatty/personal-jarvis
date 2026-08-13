# JARVIS — personal aide

Wade Beatty’s personal Jarvis voice webapp: a dark Iron Man–inspired HUD on Netlify, talking to an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/libraries/java-script) agent via the **Client SDK**.

This is a **personal aide only** — not Western Pest, not ward ministry.

## What it does

- Single-page HUD (`public/`) with Initiate / End conversation controls
- Voice session via [`@elevenlabs/client`](https://www.npmjs.com/package/@elevenlabs/client) (CDN browser bundle)
- **Authenticated agent** (`enable_auth: true`) — the browser never gets `ELEVENLABS_API_KEY` and never embeds the public `agent-id`
- Netlify Function `GET /.netlify/functions/signed-url` mints a short-lived signed URL, then the HUD calls `Conversation.startSession({ signedUrl })`
- **Read-only brain tools** (server-side only): Google Calendar, Gmail, and Contacts. Jarvis can answer “what’s on my calendar tomorrow?” and “any email from X?” during a call. No send-mail, no calendar writes, no SMS.

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
6. If Wade asks about schedule / inbox / people, the agent says a brief “let me check”, then ElevenLabs POSTs JSON to the matching tool function with `X-Jarvis-Secret`.
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
   | `JARVIS_TOOL_SECRET` | Long random string; same value the register script sends to ElevenLabs |
   | `GOOGLE_CLIENT_ID` | OAuth Desktop client ID |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret |
   | `GOOGLE_REFRESH_TOKEN` | From `scripts/google-oauth-setup.mjs` (or Playground with **your** client) |

4. Deploy. Production and Deploy Previews both need the same secrets so signed-url and tools can run.
5. After the functions are live, run `npm run tools:register` once (see below) so the ElevenLabs agent points at production URLs.

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

## Brain tools (read-only)

All three are `POST` JSON, protected by header `X-Jarvis-Secret` matching `JARVIS_TOOL_SECRET`. Responses are short, speakable JSON (no HTML), capped at **5** items. Timezone: **America/Denver**.

| Function | URL | Body | Speaks |
| --- | --- | --- | --- |
| `tools-calendar.ts` | `/.netlify/functions/tools-calendar` | `{ query, start?, end? }` | `summary` + `events[{ when, title, where }]` |
| `tools-email.ts` | `/.netlify/functions/tools-email` | `{ query, q? }` | `summary` + `messages[{ from, subject, date, snippet }]` |
| `tools-contacts.ts` | `/.netlify/functions/tools-contacts` | `{ query }` | `summary` + `contacts[{ name, emails, phones }]` |

Missing/wrong secret → `401`. Google env missing → `{ ok: false, summary: "Google access is not configured yet." }` (so Jarvis can say that out loud).

Shared helpers live in `netlify/functions/_shared/` (underscore prefix so Netlify does not deploy them as functions).

### Google OAuth (one-time, manual)

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

### Register ElevenLabs webhook tools

After production has the tool functions and `JARVIS_TOOL_SECRET`:

```bash
# .env should contain ELEVENLABS_API_KEY and JARVIS_TOOL_SECRET
npm run tools:register
```

`scripts/register-elevenlabs-tools.mjs` will:

1. Create or update workspace secret `JARVIS_TOOL_SECRET` (value from env — not hardcoded).
2. Create or update webhook tools `jarvis_calendar`, `jarvis_email`, `jarvis_contacts` pointing at  
   `https://personal-jarvis-813.netlify.app/.netlify/functions/tools-*`  
   (`POST`, header `X-Jarvis-Secret` via that secret).
3. Attach those `tool_ids` to agent `agent_0901kzw48twfeq4ar7jn0f87dx94`.
4. Replace the agent system prompt with `scripts/jarvis-system-prompt.txt` (tools + walls; no “conversational only”).

Optional: `JARVIS_TOOL_BASE_URL` for a preview deploy. Re-run the script after prompt or URL changes.

Do **not** copy Western/Cleo tool URLs or secrets into this project.

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

## Manual voice check

On the deployed site (HTTPS), after Google env + `JARVIS_TOOL_SECRET` are set and `npm run tools:register` has been run:

1. Click **Initiate** and allow the microphone.
2. HUD should move AUTHORIZING → CONNECTING → **ONLINE** (not ONLINE before the session exists).
3. Hear Jarvis’s first spoken message (orb **SPEAKING**).
4. Ask: **“What’s on my calendar tomorrow?”** — he should say a brief “let me check”, then read events (or say there are none).
5. Ask: **“Any email from [someone in your inbox]?”** — subject / from / short gist only.
6. Ask: **“What’s [contact name]’s number?”**
7. Ask something Western-ops or ward-pastoral — he should redirect (Western / Cleo, or Steward), not call those systems.
8. Click **End conversation** → STANDBY.
9. ElevenLabs conversation history for the agent should show the session and tool calls.

Local curl check (does not need ElevenLabs):

```bash
curl -sS -X POST "$URL/.netlify/functions/tools-calendar" \
  -H "Content-Type: application/json" \
  -H "X-Jarvis-Secret: $JARVIS_TOOL_SECRET" \
  -d '{"query":"tomorrow"}'
```

Wrong or missing secret must return `401`.

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
  register-elevenlabs-tools.mjs
  jarvis-system-prompt.txt
tests/
netlify.toml
.env.example
```
