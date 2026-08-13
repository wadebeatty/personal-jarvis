const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      }
      return HTML_ENTITIES[ent.toLowerCase()] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, max = 160): string {
  const clean = stripHtml(text);
  if (clean.length <= max) return clean;
  const sliced = clean.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${(lastSpace > 80 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

/** "Jane Doe <jane@x.com>" → "Jane Doe" */
export function displayFrom(from: string): string {
  const trimmed = from.trim();
  const angled = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angled && angled[1].trim()) {
    return stripHtml(angled[1])
      .replace(/^["']+|["']+$/g, "")
      .trim();
  }
  return stripHtml(trimmed);
}

export function countLabel(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}
