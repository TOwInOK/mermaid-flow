import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = await Promise.all(
  ["src/10-constants.js", "src/20-file-utils.js", "src/30-mermaid-language.js"].map(
    (file) => fs.readFile(path.join(root, file), "utf8"),
  ),
);

function sandbox(desktop) {
  const context = vm.createContext({
    window: { hermesDesktop: desktop },
    atom: (value) => ({ get: () => value, set: () => {} }),
    TextEncoder,
    console,
  });
  vm.runInContext(`${sources.join("\n")}\nthis.api = {
    createDiagramSnapshot,
    ensureMmdName,
    extractDocIds,
    extractSource,
    normalizeMermaidSource,
    packSource,
    readDiagramForSwitch,
  };`, context);
  return context.api;
}

assert.equal(sandbox({}).ensureMmdName(" Road Map.mermaid "), "Road-Map.mmd");
assert.equal(
  sandbox({}).normalizeMermaidSource("A → B"),
  "flowchart TD\nA --> B\n",
);
assert.equal(
  sandbox({}).extractSource("```mermaid\nA --> B\n```", "flow.md"),
  "flowchart TD\nA --> B\n",
);
assert.equal(
  sandbox({}).packSource("A --> B", "flow.md"),
  "```mermaid\nflowchart TD\nA --> B\n```\n",
);
assert.deepEqual(
  Array.from(sandbox({}).extractDocIds("flowchart TD\nflowchart\nparticipant Foo")),
  ["Foo"],
);

{
  const writes = [];
  const api = sandbox({
    writeTextFile: async (file, source) => {
      writes.push([file, source]);
      throw new Error("save denied");
    },
  });
  await assert.rejects(
    api.readDiagramForSwitch("/next.mmd", {
      dirty: true,
      path: "/current.mmd",
      source: "flowchart TD\nA --> B\n",
    }),
    /save denied/,
  );
  assert.equal(writes.length, 1);
}

{
  let writes = 0;
  const api = sandbox({
    readDir: async () => ({
      entries: [{ name: "Exists.mmd", path: "/d/Exists.mmd", isDirectory: false }],
    }),
    writeTextFile: async () => {
      writes += 1;
    },
  });
  await assert.rejects(
    api.createDiagramSnapshot("/d", "exists.mmd", "flowchart TD"),
    /already exists/,
  );
  assert.equal(writes, 0);
}

{
  let writes = 0;
  const api = sandbox({
    readDir: async () => ({ entries: [], error: "EACCES" }),
    writeTextFile: async () => {
      writes += 1;
    },
  });
  await assert.rejects(
    api.createDiagramSnapshot("/d", "new.mmd", "flowchart TD"),
    /EACCES/,
  );
  assert.equal(writes, 0);
}

console.log("pure checks passed");
