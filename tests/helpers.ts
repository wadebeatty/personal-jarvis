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

export function getRequest(url: string, secret = TOOL_ENV.JARVIS_TOOL_SECRET) {
  return new Request(url, {
    method: "GET",
    headers: secret ? { "X-Jarvis-Secret": secret } : {},
  });
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
