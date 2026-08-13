#!/usr/bin/env node
/**
 * One-time Google OAuth for Jarvis read-only Calendar / Gmail / Contacts.
 *
 * Prerequisites (Google Cloud Console, on Wade's Mac):
 *   1. Create (or reuse) a project.
 *   2. Enable: Google Calendar API, Gmail API, People API.
 *   3. OAuth consent screen → External (or Internal) → add yourself as a test user.
 *   4. Credentials → Create OAuth client ID → Desktop app.
 *   5. Add authorized redirect URI: http://127.0.0.1:8765/oauth2callback
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth-setup.mjs
 *
 * Prints a refresh token. Put it in Netlify env as GOOGLE_REFRESH_TOKEN.
 * Never commit the token.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
];

const PORT = Number(process.env.GOOGLE_OAUTH_PORT || 8765);
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${PORT}/oauth2callback`;

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
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

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (env or .env).");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(
      payload.error_description || payload.error || `Token exchange failed (${res.status})`,
    );
  }
  return payload;
}

function printTokens(payload) {
  if (!payload.refresh_token) {
    console.error(
      "Google did not return a refresh_token. Re-run with prompt=consent (this script already sets it), and confirm the OAuth client is a Desktop app using your own credentials — not the OAuth Playground default client.",
    );
    process.exit(1);
  }
  console.log("\nSuccess. Add these to Netlify (Site configuration → Environment variables):\n");
  console.log(`GOOGLE_CLIENT_ID=${clientId}`);
  console.log("GOOGLE_CLIENT_SECRET=<already have>");
  console.log(`GOOGLE_REFRESH_TOKEN=${payload.refresh_token}`);
  console.log(
    "\nDo not commit the refresh token. The access token is short-lived and not stored in env.\n",
  );
}

function waitForCodeViaLocalhost() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (err || !code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Authorization failed. You can close this tab.");
        server.close();
        reject(new Error(err || "No code"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Jarvis Google access granted. You can close this tab and return to the terminal.");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log("Open this URL in a browser signed in as Wade:\n");
      console.log(authUrl.toString());
      console.log(`\nWaiting for redirect to ${REDIRECT_URI} …`);
      const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", authUrl.toString()] : [authUrl.toString()];
      try {
        spawn(opener, args, { stdio: "ignore", detached: true }).unref();
      } catch {
        // Browser open is optional.
      }
    });
  });
}

async function waitForPastedCode() {
  console.log("Open this URL in a browser signed in as Wade:\n");
  console.log(authUrl.toString());
  const rl = createInterface({ input, output });
  const code = (await rl.question("\nPaste the ?code= value from the redirect URL: ")).trim();
  rl.close();
  if (!code) throw new Error("No code pasted");
  return code;
}

const usePaste = process.argv.includes("--paste");
try {
  const code = usePaste ? await waitForPastedCode() : await waitForCodeViaLocalhost();
  const payload = await exchangeCode(code);
  printTokens(payload);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
