import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getStore } from "@netlify/blobs";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const toml = readFileSync(new URL("netlify.toml", root), "utf8");

test("production functions can resolve @netlify/blobs from package.json dependencies", () => {
  assert.equal(typeof pkg.dependencies?.["@netlify/blobs"], "string");
  assert.equal(typeof pkg.devDependencies?.["@netlify/blobs"], "undefined");
  assert.equal(typeof getStore, "function");
  const resolved = createRequire(import.meta.url).resolve("@netlify/blobs");
  assert.match(resolved, /node_modules\/@netlify\/blobs\//);
});

test("Netlify build installs node_modules before functions are packaged", () => {
  assert.match(toml, /^\s*command\s*=\s*"npm ci && npm run build"\s*$/m);
  assert.match(toml, /\[functions\]/);
  assert.match(toml, /directory\s*=\s*"netlify\/functions"/);
});
