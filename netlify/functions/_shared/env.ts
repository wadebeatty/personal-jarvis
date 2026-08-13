/** Read a Netlify / test env var. Functions use Netlify.env; tests inject it. */
export function env(name: string): string | undefined {
  const netlify = (globalThis as { Netlify?: { env?: { get(name: string): string | undefined } } })
    .Netlify;
  if (netlify?.env?.get) {
    return netlify.env.get(name);
  }
  return process.env[name];
}
