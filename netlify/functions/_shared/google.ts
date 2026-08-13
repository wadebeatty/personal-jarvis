import { env } from "./env.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
};

let cache: TokenCache | null = null;

export function resetGoogleAuthCache() {
  cache = null;
}

function requireGoogleEnv(): { clientId: string; clientSecret: string; refreshToken: string } {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("google-not-configured");
  }
  return { clientId, clientSecret, refreshToken };
}

export async function getGoogleAccessToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = requireGoogleEnv();
  if (cache && cache.refreshToken === refreshToken && Date.now() < cache.expiresAt - 60_000) {
    return cache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new Error("google-auth-failed");
  }

  if (!res.ok) {
    throw new Error("google-auth-failed");
  }

  let payload: { access_token?: string; expires_in?: number };
  try {
    payload = (await res.json()) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error("google-auth-failed");
  }

  if (!payload.access_token) {
    throw new Error("google-auth-failed");
  }

  cache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    refreshToken,
  };
  return cache.accessToken;
}

export async function googleFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getGoogleAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error("google-request-failed");
  }

  if (res.status === 401) {
    resetGoogleAuthCache();
    const retryToken = await getGoogleAccessToken();
    headers.set("Authorization", `Bearer ${retryToken}`);
    try {
      res = await fetch(url, { ...init, headers });
    } catch {
      throw new Error("google-request-failed");
    }
  }

  return res;
}

export async function googleJson<T>(url: string | URL): Promise<T> {
  const res = await googleFetch(url);
  if (!res.ok) {
    throw new Error("google-request-failed");
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("google-request-failed");
  }
}
