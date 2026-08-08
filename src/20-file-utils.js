function bridge() {
  return typeof window !== "undefined" ? window.hermesDesktop : null;
}

function joinPath(a, b) {
  if (!a) return b || "";
  if (!b) return a;
  const left = String(a).replace(/[/\\]+$/, "");
  const right = String(b).replace(/^[/\\]+/, "");
  const sep = left.includes("\\") && !left.includes("/") ? "\\" : "/";
  return `${left}${sep}${right}`;
}

function baseName(p) {
  const s = String(p || "").replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function parentDir(p) {
  return String(p || "").replace(/[/\\][^/\\]+$/, "");
}

function isAbsPath(p) {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(String(p || ""));
}

function resolveDiagramsDir(cwd, configured) {
  const conf = (configured || DEFAULT_REL_DIR).trim() || DEFAULT_REL_DIR;
  if (isAbsPath(conf)) return conf;
  if (!cwd) return conf;
  return joinPath(cwd, conf);
}

function slugifyName(raw) {
  // Keep letters (incl. non-ASCII), digits, . _ - ; strip path/illegal chars.
  // Avoid \p{} — some Electron builds reject Unicode properties in char classes.
  const s = String(raw || "")
    .trim()
    .replace(/\.(mmd|md|mermaid)$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "diagram";
}

function ensureMmdName(name) {
  return `${slugifyName(name)}.mmd`;
}

async function fsReadDir(dir) {
  const b = bridge();
  if (!b) throw new Error("Desktop bridge unavailable");
  return b.readDir(dir);
}

async function fsReadText(path) {
  const b = bridge();
  if (!b) throw new Error("Desktop bridge unavailable");
  const res = await b.readFileText(path);
  return res.text;
}

/** Ensure dir exists. The current bridge has no silent mkdir; creation opens FM. */
async function fsEnsureDir(dir, { open = false } = {}) {
  const b = bridge();
  if (!b) throw new Error("Desktop bridge unavailable");
  const listed = await fsReadDir(dir);
  if (!listed.error && !open) return true;
  if (listed.error && listed.error !== "ENOENT") throw new Error(listed.error);
  if (!b.openDir) throw new Error("Cannot create folder (openDir missing)");
  const res = await b.openDir(dir);
  if (!res.ok) throw new Error(res.error || "Cannot open folder");
  return true;
}

async function listDiagramFiles(dir) {
  const res = await fsReadDir(dir);
  if (res?.error) {
    const err = new Error(res.error);
    err.code = "LIST";
    throw err;
  }
  return res.entries
    .filter(
      (e) => !e.isDirectory && /\.(mmd|mermaid|md)$/i.test(e.name),
    )
    .map((e) => {
      return {
        name: e.name,
        path: e.path,
        label: e.name.replace(/\.(mmd|mermaid|md)$/i, ""),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Pull mermaid body from raw .mmd or fenced .md */
function extractSource(text, fileName) {
  const raw = String(text ?? "");
  if (/\.md$/i.test(fileName || "")) {
    const m = raw.match(/```mermaid\s*([\s\S]*?)```/i);
    if (m) return normalizeMermaidSource(m[1]);
  }
  return normalizeMermaidSource(raw);
}

/**
 * Soft-normalize paste / editor body so common copy mistakes still render:
 *  - strip ```mermaid fences
 *  - unicode arrows → ASCII
 *  - bare node edges without diagram header → flowchart TD
 */
function normalizeMermaidSource(raw) {
  let s = String(raw ?? "").replace(/\r\n/g, "\n");

  // whole-buffer fence
  const whole = s.match(/^\s*```(?:mermaid)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (whole) s = whole[1];
  else if (/```mermaid/i.test(s)) {
    const m = s.match(/```mermaid\s*([\s\S]*?)```/i);
    if (m) s = m[1];
  }

  s = s
    .replace(/\u2192/g, "-->") // →
    .replace(/\u27f6/g, "-->") // ⟶
    .replace(/\u21d2/g, "==>") // ⇒
    .replace(/<br\s*>/gi, "<br/>");

  const trimmed = s.trim();
  if (!trimmed) return "";

  const DIAGRAM_START =
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|quadrantChart|requirementDiagram|xychart(?:-beta)?|block-beta|sankey(?:-beta)?|packet(?:-beta)?|architecture(?:-beta)?|radar(?:-beta)?)\b/i;

  const first = trimmed
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));

  if (first && !DIAGRAM_START.test(first)) {
    // body looks like flowchart edges/nodes without a header
    if (
      /-->|---|==>|-\.-|subgraph|\[[^\]]*]|\{[^}]*\}|\(\([^)]*\)\)/.test(
        trimmed,
      )
    ) {
      s = `flowchart TD\n${trimmed}`;
    }
  }

  return String(s).replace(/\s+$/, "") + "\n";
}

function packSource(source, fileName) {
  const body = normalizeMermaidSource(source);
  if (/\.md$/i.test(fileName || "")) {
    return "```mermaid\n" + body.trim() + "\n```\n";
  }
  return body;
}

/** Pack and write an immutable diagram snapshot through the only write path. */
let snapshotWriteQueue = Promise.resolve();

async function performDiagramWrite(path, source) {
  const b = bridge();
  if (!b?.writeTextFile) throw new Error("writeTextFile unavailable");
  const packed = packSource(source, baseName(path));
  try {
    await b.writeTextFile(path, packed);
  } catch (err) {
    if ((err?.message || String(err)) !== "Parent directory does not exist") {
      throw err;
    }
    await fsEnsureDir(parentDir(path));
    await b.writeTextFile(path, packed);
  }
}

function writeDiagramSnapshot(path, source) {
  // ponytail: one global queue; split per path only if save throughput matters.
  const write = snapshotWriteQueue.then(() => performDiagramWrite(path, source));
  snapshotWriteQueue = write.catch(() => {});
  return write;
}

async function readDiagramForSwitch(path, current) {
  if (current?.dirty && current.path) {
    await writeDiagramSnapshot(current.path, current.source);
  }
  return extractSource(await fsReadText(path), baseName(path));
}

async function createDiagramSnapshot(dir, fileName, source) {
  await fsEnsureDir(dir);
  const files = await listDiagramFiles(dir);
  const foldedName = fileName.toLowerCase();
  if (files.some((file) => file.name.toLowerCase() === foldedName)) {
    throw new Error(`${fileName} already exists`);
  }
  const path = joinPath(dir, fileName);
  await writeDiagramSnapshot(path, source);
  return path;
}

function isMermaidPath(path) {
  return /\.(mmd|mermaid|md)$/i.test(String(path || ""));
}

/**
 * Hermes files tree drag payload:
 *   application/x-hermes-paths = JSON [{ isDirectory, path }]
 *   text/plain = absolute path
 */
function pathsFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];

  const hermes = dt.getData("application/x-hermes-paths");
  if (hermes) {
    try {
      const parsed = JSON.parse(hermes);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.path === "string" && !item.isDirectory)
            out.push(item.path);
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!out.length) {
    const plain = dt.getData("text/plain")?.trim();
    if (plain && (plain.startsWith("/") || /^[A-Za-z]:[\\/]/.test(plain)))
      out.push(plain);
  }

  // OS / external file drag
  if (dt.files && dt.files.length) {
    for (const f of dt.files) {
      const p =
        f.path ||
        (typeof window !== "undefined" &&
          window.hermesDesktop?.getPathForFile?.(f));
      if (p) out.push(p);
    }
  }

  return [...new Set(out.filter(Boolean))];
}

function hasHermesFileDrag(dt) {
  if (!dt) return false;
  const types = dt.types ? Array.from(dt.types) : [];
  if (types.includes("application/x-hermes-paths")) return true;
  if (types.includes("Files")) return true;
  if (types.includes("text/plain")) return true;
  return false;
}

