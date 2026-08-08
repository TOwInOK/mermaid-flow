// Pure Mermaid source, highlighting, and completion logic.

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(color, text) {
  return `<span style="color:${color}">${escHtml(text)}</span>`;
}

/**
 * Line-oriented mermaid highlighter. Returns HTML (escaped text + colored spans).
 * Palette matches Hermes CodeMirror github theme.
 */
function highlightMermaidHtml(code, dark) {
  const p = dark ? GH_DARK : GH_LIGHT;
  if (!code) return "";

  const lines = code.split("\n");
  const out = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trimStart();

    // full-line comment (not %%{init)
    if (trimmed.startsWith("%%") && !trimmed.startsWith("%%{")) {
      out.push(span(p.comment, line));
      continue;
    }

    let i = 0;
    let html = "";
    const pushPlain = (chunk) => {
      if (!chunk) return;
      html += escHtml(chunk);
    };

    while (i < line.length) {
      // whitespace
      if (/\s/.test(line[i])) {
        let j = i + 1;
        while (j < line.length && /\s/.test(line[j])) j++;
        pushPlain(line.slice(i, j));
        i = j;
        continue;
      }

      // inline / trailing comment
      if (line[i] === "%" && line[i + 1] === "%" && line[i + 2] !== "{") {
        html += span(p.comment, line.slice(i));
        break;
      }

      // %%{ ... }%% directive
      if (line.startsWith("%%{", i)) {
        const end = line.indexOf("}%%", i);
        if (end !== -1) {
          html += span(p.comment, line.slice(i, end + 3));
          i = end + 3;
          continue;
        }
      }

      // quoted strings "..." or '...'
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== q) {
          if (line[j] === "\\") j++;
          j++;
        }
        if (j < line.length) j++;
        html += span(p.string, line.slice(i, j));
        i = j;
        continue;
      }

      // bracket labels ["..."] / ["text"] already handled by quotes inside;
      // bare [...] text
      if (line[i] === "[" || line[i] === "(" || line[i] === "{") {
        const open = line[i];
        const close = open === "[" ? "]" : open === "(" ? ")" : "}";
        // shape openers like [[, [(, (( etc.
        let j = i + 1;
        while (
          j < line.length &&
          (line[j] === open ||
            line[j] === "(" ||
            line[j] === "[" ||
            line[j] === "{")
        )
          j++;
        const openChunk = line.slice(i, j);
        html += span(p.fg, openChunk);
        i = j;
        // content until matching-ish close (simplified)
        let depth = 1;
        let k = i;
        let buf = "";
        while (k < line.length && depth > 0) {
          if (line[k] === '"' || line[k] === "'") {
            if (buf) {
              html += span(p.string, buf);
              buf = "";
            }
            const q = line[k];
            let t = k + 1;
            while (t < line.length && line[t] !== q) {
              if (line[t] === "\\") t++;
              t++;
            }
            if (t < line.length) t++;
            html += span(p.string, line.slice(k, t));
            k = t;
            continue;
          }
          if (
            line[k] === open ||
            line[k] === "[" ||
            line[k] === "(" ||
            line[k] === "{"
          )
            depth++;
          if (
            line[k] === close ||
            line[k] === "]" ||
            line[k] === ")" ||
            line[k] === "}"
          ) {
            depth--;
            if (depth === 0) break;
          }
          buf += line[k];
          k++;
        }
        if (buf) html += span(p.string, buf);
        i = k;
        continue;
      }

      // arrows / edges
      const arrow2 = line
        .slice(i)
        .match(
          /^(-->|---|==>|-\.->|->>|-->>|--o|--x|-\.-x|-\.-|~~>|~~|==|--)|\|[^|\n]*\|/,
        );
      if (arrow2) {
        html += span(p.constant, arrow2[0]);
        i += arrow2[0].length;
        continue;
      }

      // numbers
      if (/\d/.test(line[i])) {
        let j = i;
        while (j < line.length && /[\d.]/.test(line[j])) j++;
        html += span(p.number, line.slice(i, j));
        i = j;
        continue;
      }

      // identifiers / keywords
      if (/[A-Za-z_@*]/.test(line[i])) {
        let j = i + 1;
        while (j < line.length && /[A-Za-z0-9_$@.*-]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (MM_DIAGRAM.has(word)) html += span(p.type, word);
        else if (MM_KEYWORD.has(word)) html += span(p.keyword, word);
        else if (word === "true" || word === "false" || word === "null")
          html += span(p.number, word);
        else html += span(p.entity, word);
        i = j;
        continue;
      }

      // punctuation
      html += span(p.fg, line[i]);
      i++;
    }

    out.push(html);
  }

  // trailing newline: split keeps last empty line — join with \n
  return out.join("\n") + (code.endsWith("\n") ? "\n" : "");
}

/**
 * Collect node / participant / actor IDs from the diagram source.
 * Labels (quoted strings, bracket text) are stripped first — only IDs.
 */
function extractDocIds(text) {
  let s = String(text || "");
  // strip directives + line comments
  s = s.replace(/%%\{[\s\S]*?\}%%/g, " ");
  s = s.replace(/%%[^\n]*/g, " ");
  // strip quoted labels
  s = s.replace(/"(?:\\.|[^"\\])*"/g, " ");
  s = s.replace(/'(?:\\.|[^'\\])*'/g, " ");
  // strip pipe edge labels -->|label|
  s = s.replace(/\|[^|\n]*\|/g, " ");

  const ids = new Set();

  const add = (raw) => {
    if (!raw) return;
    const id = String(raw);
    if (id.length < 1 || id.length > 64) return;
    if (MM_RESERVED.has(id) || MM_RESERVED.has(id.toLowerCase())) return;
    if (!/^[A-Za-z_@][\w.-]*$/.test(id)) return;
    ids.add(id);
  };

  // participant Foo / actor U / state Name
  for (const m of s.matchAll(
    /\b(?:participant|actor|state)\s+([A-Za-z_@][\w.-]*)/gi,
  ))
    add(m[1]);
  // subgraph id
  for (const m of s.matchAll(/\bsubgraph\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1]);
  // Node shapes: Foo[  Foo(  Foo{  Foo((
  for (const m of s.matchAll(/\b([A-Za-z_@][\w.-]*)\s*(?:\[|\(\(|\(|\{\{|\{)/g))
    add(m[1]);
  // Edges: A --> B / A->>B / A -->> B
  for (const m of s.matchAll(
    /\b([A-Za-z_@][\w.-]*)\s*(?:-->|---|==>|-\.->|->>|-->>|-\)|--\)|~~>)\s*([A-Za-z_@][\w.-]*)/g,
  )) {
    add(m[1]);
    add(m[2]);
  }
  // style / click / class targets
  for (const m of s.matchAll(/\b(?:style|click|class)\s+([A-Za-z_@][\w.-]*)/gi))
    add(m[1]);
  // activate / deactivate
  for (const m of s.matchAll(
    /\b(?:activate|deactivate)\s+([A-Za-z_@][\w.-]*)/gi,
  ))
    add(m[1]);
  // Note … of A / Note over A,B
  for (const m of s.matchAll(
    /\bNote\s+(?:left|right)\s+of\s+([A-Za-z_@][\w.-]*)/gi,
  ))
    add(m[1]);
  for (const m of s.matchAll(
    /\bNote\s+over\s+([A-Za-z_@][\w.-]*)\s*(?:,\s*([A-Za-z_@][\w.-]*))?/gi,
  )) {
    add(m[1]);
    add(m[2]);
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Expand insert template: strip `$0` and return caret offset inside insert. */
function expandInsert(insert) {
  const raw = String(insert ?? "");
  const idx = raw.indexOf("$0");
  if (idx === -1) return { text: raw, caretInInsert: raw.length };
  return { text: raw.slice(0, idx) + raw.slice(idx + 2), caretInInsert: idx };
}


/**
 * @returns {null | { next: string, caret: number, sel?: [number, number] }}
 */
function applyAutoPair(text, start, end, key) {
  const close = MM_PAIRS[key];
  if (close) {
    const selected = text.slice(start, end);
    const next =
      text.slice(0, start) + key + selected + close + text.slice(end);
    if (start === end) return { next, caret: start + 1 };
    // wrap: caret after content (before close); caller may reselect inner
    return { next, caret: end + 1, sel: [start + 1, end + 1] };
  }
  // type-through existing closer
  if (start === end && text[start] === key) {
    for (const c of Object.values(MM_PAIRS)) {
      if (c === key) return { next: text, caret: start + 1 };
    }
  }
  return null;
}

/** Backspace between empty pair → delete both. */
function applyPairBackspace(text, start, end) {
  if (start !== end || start < 1) return null;
  const left = text[start - 1];
  const right = text[start];
  if (MM_PAIRS[left] === right) {
    return {
      next: text.slice(0, start - 1) + text.slice(start + 1),
      caret: start - 1,
    };
  }
  return null;
}

/**
 * Prefix at caret. Word and edge runs are separate so `A-->` is not one token.
 * `-` was previously in the word charset → edges never completed while typing.
 * @returns {{ start: number, prefix: string, mode: "word" | "edge" }}
 */
function completionPrefixAt(text, pos) {
  let j = pos;
  let wordStart = pos;
  while (wordStart > 0 && /[A-Za-z0-9_@.*%-]/.test(text[wordStart - 1]))
    wordStart--;
  const wordPrefix = text.slice(wordStart, pos);
  if (
    wordPrefix.includes("-") &&
    [...MM_DIAGRAM, ...MM_KEYWORD].some((x) => x.startsWith(wordPrefix)) &&
    (wordStart === 0 || /\s/.test(text[wordStart - 1]))
  ) {
    return { start: wordStart, prefix: wordPrefix, mode: "word" };
  }
  if (j > 0 && /[-=~.>]/.test(text[j - 1])) {
    while (j > 0 && /[-=~.>]/.test(text[j - 1])) j--;
    return { start: j, prefix: text.slice(j, pos), mode: "edge" };
  }
  // no `-` here — edges use mode above
  while (j > 0 && /[A-Za-z0-9_@.*%]/.test(text[j - 1])) j--;
  return { start: j, prefix: text.slice(j, pos), mode: "word" };
}

/** True when caret is inside a "…" / '…' or after `%%` comment on the line. */
function inStringOrComment(text, pos) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const line = text.slice(lineStart, pos);
  const pct = line.indexOf("%%");
  if (pct !== -1 && line[pct + 2] !== "{") return true;

  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
  }
  return quote !== null;
}

function detectDiagramKind(text) {
  const head = text.slice(0, 400);
  if (/sequenceDiagram/i.test(head)) return "sequence";
  if (/stateDiagram/i.test(head)) return "state";
  if (/classDiagram/i.test(head)) return "class";
  if (/erDiagram/i.test(head)) return "er";
  if (/flowchart|^\s*graph\b/im.test(head)) return "flow";
  if (/gantt/i.test(head)) return "gantt";
  if (/gitGraph/i.test(head)) return "git";
  if (/requirementDiagram/i.test(head)) return "requirement";
  return "";
}

/**
 * Lower score = better. null = no match.
 * Keep base ≥ 50 so boosts never collide with "no match".
 */
function scoreCompletion(c, p, mode) {
  if (!p) {
    if (mode === "edge") return c.kind === "edge" ? 0 : 100;
    return c.kind === "id" ? 0 : c.generated ? 30 : 20;
  }
  const lab = c.label.toLowerCase();
  const ins = c.insert.toLowerCase().replace(/\$0/g, "");
  let s;
  if (lab === p || ins === p) s = 50;
  else if (lab.startsWith(p)) s = 60;
  else if (ins.startsWith(p)) s = 65;
  else if (lab.includes(p)) s = 90;
  else if (ins.includes(p)) s = 100;
  else return null;
  if (c.kind === "id") s -= 5;
  if (mode === "edge" && c.kind === "edge") s -= 8;
  if (mode === "edge" && c.kind !== "edge") s += 30;
  if (lab.startsWith(p)) s += Math.min(lab.length - p.length, 10);
  // default solid arrow beats --- / locale tie
  if (mode === "edge" && c.label === "-->") s -= 3;
  // longer shared prefix with insert wins (e.g. `-.` → `-.->`)
  if (ins.startsWith(p)) s -= Math.min(p.length, 6);
  return s;
}

/** Fill Note/activate targets from diagram ids when present. */
function bindDocIds(item, ids) {
  if (!ids.length) return item;
  const a = ids[0];
  const b = ids[1] || ids[0];
  const lab = item.label;
  if (lab === "Note right of")
    return { ...item, insert: `Note right of ${a}: $0` };
  if (lab === "Note left of")
    return { ...item, insert: `Note left of ${a}: $0` };
  if (lab === "Note over")
    return { ...item, insert: `Note over ${a},${b}: $0` };
  if (lab === "activate" || lab === "deactivate")
    return { ...item, insert: `${lab} ${a}` };
  if (lab === "note right of")
    return { ...item, insert: `note right of ${a}\n  $0\nend note` };
  if (lab === "style" || lab === "click")
    return {
      ...item,
      insert: item.insert.replace("$0", a),
    };
  return item;
}

/**
 * Completion list for caret position.
 * @param {boolean} [force] full catalog (Ctrl+Space); else context-filtered.
 * @returns {{ items: MmCompletion[], replaceStart: number, replaceEnd: number }}
 */
function mermaidCompletions(text, pos, force = false) {
  if (!force && inStringOrComment(text, pos)) {
    return { items: [], replaceStart: pos, replaceEnd: pos };
  }

  const { start, prefix, mode } = completionPrefixAt(text, pos);
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const lineBefore = text.slice(lineStart, start);
  const trimmedDoc = text.trim();
  const kind = detectDiagramKind(text);
  const p = prefix.toLowerCase();

  /** @type {MmCompletion[]} */
  let pool = MM_ALL_COMPLETIONS;

  if (!force && kind === "class") {
    const phrase = text.slice(lineStart, pos).trimStart().toLowerCase();
    const match =
      phrase &&
      MM_ALL_COMPLETIONS.find(
        (c) =>
          c.kind === "class" &&
          c.label.includes(" ") &&
          c.label.startsWith(phrase),
      );
    if (match) {
      return {
        items: [match],
        replaceStart: lineStart + text.slice(lineStart, pos).search(/\S|$/),
        replaceEnd: pos,
      };
    }
  }

  // Ctrl+Space → catalog (+ rank). Typing → context-narrowed pool.
  if (!force) {
    if (mode === "edge") {
      pool = MM_ALL_COMPLETIONS.filter((c) => c.kind === "edge");
    } else if (
      !trimmedDoc ||
      (lineStart === 0 && !lineBefore.trim() && start === 0)
    ) {
      pool = MM_ALL_COMPLETIONS.filter((c) => c.kind === "diagram");
    } else if (/^(flowchart|graph)\s*$/i.test(lineBefore)) {
      pool = MM_ALL_COMPLETIONS.filter((c) => c.kind === "dir");
    } else if (kind === "sequence") {
      pool = MM_ALL_COMPLETIONS.filter(
        (c) => c.kind === "seq" || c.kind === "kw" || c.kind === "edge",
      );
    } else if (kind === "flow") {
      pool = MM_ALL_COMPLETIONS.filter(
        (c) =>
          c.kind === "kw" ||
          c.kind === "edge" ||
          c.kind === "node" ||
          c.kind === "dir",
      );
    } else if (kind === "state") {
      pool = MM_ALL_COMPLETIONS.filter(
        (c) =>
          c.kind === "kw" ||
          c.label.startsWith("state") ||
          c.label === "[*]" ||
          c.label.startsWith("note"),
      );
    } else if (kind === "class") {
      pool = MM_ALL_COMPLETIONS.filter((c) =>
        MM_CLASS_COMPLETION_LABELS.has(c.label),
      );
    } else if (kind === "er" || kind === "gantt") {
      // thin: keywords only; ids still added below
      pool = MM_ALL_COMPLETIONS.filter((c) => c.kind === "kw");
    } else if (kind === "git" || kind === "requirement") {
      pool = MM_ALL_COMPLETIONS.filter((c) => c.kind === "kw");
    }
  }

  const docIds = extractDocIds(text);
  /** @type {MmCompletion[]} */
  const idItems =
    mode === "edge"
      ? []
      : docIds.map((id) => ({
          label: id,
          insert: id,
          detail: "from diagram",
          kind: "id",
        }));

  const scored = [];
  for (const c of idItems) {
    const s = scoreCompletion(c, p, mode);
    if (s != null) scored.push({ c, s });
  }
  for (const raw of pool) {
    const c = bindDocIds(raw, docIds);
    const s = scoreCompletion(c, p, mode);
    if (s != null) scored.push({ c, s });
  }
  scored.sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label));

  // ponytail: cap 40 on force (was 200 scroll hell); typing stays compact
  const cap = force ? 40 : 16;
  const items = scored.slice(0, cap).map((x) => x.c);

  return { items, replaceStart: start, replaceEnd: pos };
}

