import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = await fs.readFile(path.join(root, "plugin.js"), "utf8");
const includes = Array.from(
  entry.matchAll(/^\/\/ @include (.+)$/gm),
  (match) => match[1],
);
const expected = [
  "./src/00-runtime.js",
  "./src/10-constants.js",
  "./src/20-file-utils.js",
  "./src/30-mermaid-language.js",
  "./src/40-editor.js",
  "./src/50-svg-preview.js",
  "./src/60-flow-page.js",
  "./src/70-plugin-meta.js",
];
assert.deepEqual(includes, expected);
assert.equal(
  entry.replace(/^\/\/ @include .+$/gm, "").trim(),
  "/** Mermaid Flow — project-backed Mermaid editor for Hermes Desktop. */",
);

const files = await Promise.all(
  includes.map(async (file) => [
    file,
    await fs.readFile(path.join(root, file), "utf8"),
  ]),
);
const imports = files.flatMap(([file, source]) =>
  Array.from(source.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];$/gm), (match) => [
    file,
    match[1],
  ]),
);
assert(imports.length > 0);
assert(imports.every(([file]) => file === "./src/00-runtime.js"));
assert.deepEqual(
  new Set(imports.map(([, specifier]) => specifier)),
  new Set(["@hermes/plugin-sdk", "react", "react/jsx-runtime"]),
);
assert.deepEqual(
  files.filter(([, source]) => /\bexport default\b/.test(source)).map(([file]) => file),
  ["./src/70-plugin-meta.js"],
);

const all = files.map(([, source]) => source).join("\n");
const editor = files.find(([file]) => file === "./src/40-editor.js")[1];
const page = files.find(([file]) => file === "./src/60-flow-page.js")[1];
assert.match(editor, /role: "listbox",[\s\S]*?bg-\(--ui-bg-elevated\)/);
assert.match(page, /const runRender = useCallback/);
assert.match(page, /name: "folder"[\s\S]*?icons\.RefreshCw/);
assert.match(page, /icons\.Loader2/);
assert.match(page, /icons\.StopFilled/);
assert.match(page, /if \(rendering\) abortRender\(\)/);
for (const symbol of ["IconSegmentedControl", "ToolbarButton", "let os", "os = ctx.os"]) {
  assert(!all.includes(symbol), `${symbol} remains`);
}
for (const old of [
  "src/00-preamble.js",
  "src/10-core.js",
  "src/20-syntax-editor.js",
  "src/30-preview.js",
  "src/40-page-entry.js",
]) {
  await assert.rejects(fs.access(path.join(root, old)));
}

console.log("structure checks passed");
