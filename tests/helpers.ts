export type EnvMap = Record<string, string | undefined>;

export function installEnv(map: EnvMap) {
  (globalThis as { Netlify?: { env: { get(name: string): string | undefined } } }).Netlify = {
    env: {
      get(name: string) {
        return map[name];
      },
    },
  };
}

export const TOOL_ENV: EnvMap = {
  JARVIS_TOOL_SECRET: "test-jarvis-secret",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
};

export function jsonRequest(url: string, body: unknown, secret = TOOL_ENV.JARVIS_TOOL_SECRET) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Jarvis-Secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}
