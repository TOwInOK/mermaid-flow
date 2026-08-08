// ---------------------------------------------------------------------------
// Mermaid syntax highlight — mirrors Hermes code-editor palette
// (github-light-default / github-dark — see code-editor-theme.ts).
// Disk plugins can't import CodeMirror/Shiki; same token colors + overlay editor.
// ---------------------------------------------------------------------------

const GH_DARK = {
  fg: "#e6edf3",
  comment: "#8b949e",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  number: "#79c0ff",
  entity: "#d2a8ff",
  type: "#ffa657",
  tag: "#7ee787",
  constant: "#79c0ff",
};

const GH_LIGHT = {
  fg: "#1f2328",
  comment: "#57606a", // Hermes bumps light comments for readability
  keyword: "#cf222e",
  string: "#0a3069",
  number: "#0550ae",
  entity: "#8250df",
  type: "#953800",
  tag: "#116329",
  constant: "#0550ae",
};

const MM_DIAGRAM = new Set([
  "flowchart",
  "flowchart-elk",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "quadrantChart",
  "requirementDiagram",
  "info",
  "xychart",
  "xychart-beta",
  "block",
  "block-beta",
  "sankey",
  "sankey-beta",
  "packet",
  "packet-beta",
  "architecture-beta",
  "radar-beta",
  "kanban",
  "eventmodeling",
  "treemap",
  "treemap-beta",
  "venn-beta",
  "ishikawa",
  "ishikawa-beta",
  "wardley-beta",
  "cynefin-beta",
  "treeView-beta",
  "swimlane-beta",
  "railroad-beta",
  "railroad-abnf-beta",
  "railroad-ebnf-beta",
  "railroad-peg-beta",
]);

const MM_KEYWORD = new Set([
  "subgraph",
  "end",
  "direction",
  "TB",
  "BT",
  "LR",
  "RL",
  "TD",
  "participant",
  "actor",
  "as",
  "Note",
  "note",
  "over",
  "left",
  "right",
  "of",
  "activate",
  "deactivate",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "critical",
  "break",
  "rect",
  "class",
  "classDef",
  "linkStyle",
  "style",
  "click",
  "callback",
  "href",
  "state",
  "fork",
  "join",
  "choice",
  "title",
  "section",
  "dateFormat",
  "axisFormat",
  "excludes",
  "includes",
  "todayMarker",
  "autonumber",
  "box",
  "accTitle",
  "accDescr",
  "accDescription",
  "create",
  "destroy",
  "option",
  "namespace",
  "cssClass",
  "inclusiveEndDates",
  "topAxis",
  "tickInterval",
  "x-axis",
  "y-axis",
  "bar",
  "line",
  "commit",
  "branch",
  "checkout",
  "switch",
  "merge",
  "reset",
  "tag",
  "requirement",
  "functionalRequirement",
  "interfaceRequirement",
  "performanceRequirement",
  "physicalRequirement",
  "designConstraint",
  "element",
  "contains",
  "copies",
  "derives",
  "satisfies",
  "verifies",
  "refines",
  "traces",
  "Person",
  "System",
  "Boundary",
  "Container",
  "Component",
  "Node",
  "Deployment_Node",
  "Rel",
  "BiRel",
  "RelIndex",
  "UpdateElementStyle",
  "UpdateRelStyle",
  "UpdateLayoutConfig",
  "group",
  "service",
  "in",
  "junction",
  "align",
  "row",
  "column",
  "axis",
  "curve",
  "showLegend",
  "max",
  "min",
  "graticule",
  "ticks",
  "tf",
  "timeframe",
  "ui",
  "cmd",
  "command",
  "evt",
  "event",
  "processor",
  "rmo",
  "readmodel",
  "pcr",
  "rf",
  "resetframe",
  "entity",
  "data",
  "gwt",
  "given",
  "when",
  "then",
  "anchor",
  "component",
  "evolve",
  "inertia",
  "pipeline",
  "annotation",
  "complex",
  "complicated",
  "clear",
  "chaotic",
  "confusion",
  "icon",
  "columns",
  "set",
  "union",
  "showInfo",
]);

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

const EDITOR_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** @typedef {{ label: string, insert: string, detail?: string, kind?: string, generated?: boolean }} MmCompletion */

/**
 * `$0` in insert = caret landing spot after accept (stripped on insert).
 * Prefer placing `$0` inside label quotes so you type the label immediately.
 */
/** @type {MmCompletion[]} */
const MM_COMPLETIONS = [
  // diagrams
  {
    label: "flowchart TD",
    insert: "flowchart TD\n  $0",
    detail: "Top-down flow",
    kind: "diagram",
  },
  {
    label: "flowchart LR",
    insert: "flowchart LR\n  $0",
    detail: "Left-right flow",
    kind: "diagram",
  },
  {
    label: "flowchart TB",
    insert: "flowchart TB\n  $0",
    detail: "Top-bottom flow",
    kind: "diagram",
  },
  {
    label: "graph TD",
    insert: "graph TD\n  $0",
    detail: "Alias of flowchart",
    kind: "diagram",
  },
  {
    label: "flowchart-elk TD",
    insert: "flowchart-elk TD\n  $0",
    detail: "ELK flowchart",
    kind: "diagram",
  },
  {
    label: "sequenceDiagram",
    insert: "sequenceDiagram\n  $0",
    detail: "Sequence / actors",
    kind: "diagram",
  },
  {
    label: "stateDiagram-v2",
    insert: "stateDiagram-v2\n  $0",
    detail: "State machine",
    kind: "diagram",
  },
  {
    label: "classDiagram",
    insert: "classDiagram\n  $0",
    detail: "UML classes",
    kind: "diagram",
  },
  {
    label: "erDiagram",
    insert: "erDiagram\n  $0",
    detail: "Entity-relationship",
    kind: "diagram",
  },
  {
    label: "gantt",
    insert: "gantt\n  title $0\n  dateFormat YYYY-MM-DD\n  ",
    detail: "Gantt chart",
    kind: "diagram",
  },
  {
    label: "pie",
    insert: 'pie title $0\n  "A" : 40\n  "B" : 60\n',
    detail: "Pie chart",
    kind: "diagram",
  },
  {
    label: "mindmap",
    insert: "mindmap\n  root(($0))\n    A\n    B\n",
    detail: "Mind map",
    kind: "diagram",
  },
  {
    label: "timeline",
    insert: "timeline\n  title $0\n  ",
    detail: "Timeline",
    kind: "diagram",
  },
  {
    label: "gitGraph",
    insert: 'gitGraph\n  commit id: "$0"\n  ',
    detail: "Git graph",
    kind: "diagram",
  },
  {
    label: "journey",
    insert: "journey\n  title $0\n  ",
    detail: "User journey",
    kind: "diagram",
  },
  // directions
  { label: "TD", insert: "TD", detail: "Top → down", kind: "dir" },
  { label: "TB", insert: "TB", detail: "Top → bottom", kind: "dir" },
  { label: "BT", insert: "BT", detail: "Bottom → top", kind: "dir" },
  { label: "LR", insert: "LR", detail: "Left → right", kind: "dir" },
  { label: "RL", insert: "RL", detail: "Right → left", kind: "dir" },
  // structure
  {
    label: "subgraph",
    insert: 'subgraph id ["$0"]\n  \nend',
    detail: "Group nodes",
    kind: "kw",
  },
  { label: "end", insert: "end", detail: "Close subgraph/block", kind: "kw" },
  {
    label: "direction",
    insert: "direction $0",
    detail: "Subgraph direction",
    kind: "kw",
  },
  {
    label: "class",
    insert: "class $0 {\n  \n}",
    detail: "Define / assign class",
    kind: "kw",
  },
  // sequence — $0 where you type next; ids filled from doc when possible
  {
    label: "participant",
    insert: "participant $0",
    detail: "Sequence participant",
    kind: "seq",
  },
  {
    label: "actor",
    insert: "actor $0",
    detail: "Sequence actor",
    kind: "seq",
  },
  {
    label: "Note right of",
    insert: "Note right of $0: ",
    detail: "Sequence note",
    kind: "seq",
  },
  {
    label: "Note left of",
    insert: "Note left of $0: ",
    detail: "Sequence note",
    kind: "seq",
  },
  {
    label: "Note over",
    insert: "Note over $0: ",
    detail: "Note over lifelines",
    kind: "seq",
  },
  {
    label: "activate",
    insert: "activate $0",
    detail: "Activate lifeline",
    kind: "seq",
  },
  {
    label: "deactivate",
    insert: "deactivate $0",
    detail: "Deactivate lifeline",
    kind: "seq",
  },
  {
    label: "loop",
    insert: "loop $0\n  \nend",
    detail: "Loop block",
    kind: "seq",
  },
  {
    label: "alt",
    insert: "alt $0\n  \nelse\n  \nend",
    detail: "Alt / else",
    kind: "seq",
  },
  {
    label: "opt",
    insert: "opt $0\n  \nend",
    detail: "Optional block",
    kind: "seq",
  },
  {
    label: "par",
    insert: "par $0\n  \nand\n  \nend",
    detail: "Parallel block",
    kind: "seq",
  },
  {
    label: "autonumber",
    insert: "autonumber",
    detail: "Number messages",
    kind: "seq",
  },
  {
    label: "box",
    insert: "box $0\n  \nend",
    detail: "Group participants",
    kind: "seq",
  },
  {
    label: "create",
    insert: "create participant $0",
    detail: "Create participant",
    kind: "seq",
  },
  {
    label: "destroy",
    insert: "destroy $0",
    detail: "Destroy participant",
    kind: "seq",
  },
  {
    label: "critical",
    insert: "critical $0\n  \noption\n  \nend",
    detail: "Critical block",
    kind: "seq",
  },
  // flowchart edges / nodes — shape only (type id before, or edit after)
  { label: "-->", insert: "-->", detail: "Arrow", kind: "edge" },
  { label: "---", insert: "---", detail: "Link (no arrow)", kind: "edge" },
  { label: "-.->", insert: "-.->", detail: "Dotted arrow", kind: "edge" },
  { label: "==>", insert: "==>", detail: "Thick arrow", kind: "edge" },
  { label: "->>", insert: "->>", detail: "Solid open arrow", kind: "edge" },
  { label: "-->>", insert: "-->>", detail: "Dashed open arrow", kind: "edge" },
  {
    label: "-->|label|",
    insert: "-->|$0| ",
    detail: "Labeled arrow",
    kind: "edge",
  },
  {
    label: "node [rect]",
    insert: '["$0"]',
    detail: "Rectangle shape",
    kind: "node",
  },
  {
    label: "node (round)",
    insert: '("$0")',
    detail: "Rounded shape",
    kind: "node",
  },
  {
    label: "node ([stadium])",
    insert: '(["$0"])',
    detail: "Stadium shape",
    kind: "node",
  },
  {
    label: "node {rhombus}",
    insert: '{"$0"}',
    detail: "Decision shape",
    kind: "node",
  },
  {
    label: "node [(db)]",
    insert: '[("$0")]',
    detail: "Cylinder / DB",
    kind: "node",
  },
  {
    label: "node ((circle))",
    insert: '(("$0"))',
    detail: "Circle shape",
    kind: "node",
  },
  // style / misc
  {
    label: "classDef",
    insert: "classDef $0 fill:#f9f,stroke:#333",
    detail: "CSS class",
    kind: "kw",
  },
  {
    label: "namespace",
    insert: "namespace $0 {\n  \n}",
    detail: "Class namespace",
    kind: "class",
  },
  {
    label: "cssClass",
    insert: 'cssClass "$0" className',
    detail: "Assign CSS class",
    kind: "class",
  },
  {
    label: "callback",
    insert: 'callback $0 "handler"',
    detail: "Class callback",
    kind: "class",
  },
  {
    label: "link",
    insert: 'link $0 "https://"',
    detail: "Class link",
    kind: "class",
  },
  {
    label: "note for",
    insert: 'note for $0 ""',
    detail: "Class note",
    kind: "class",
  },
  {
    label: "style",
    insert: "style $0 fill:#bbf,stroke:#333",
    detail: "Inline style",
    kind: "kw",
  },
  {
    label: "linkStyle",
    insert: "linkStyle 0 stroke:#f00",
    detail: "Edge style",
    kind: "kw",
  },
  {
    label: "click",
    insert: 'click $0 href ""',
    detail: "Click handler",
    kind: "kw",
  },
  { label: "%% comment", insert: "%% $0", detail: "Line comment", kind: "kw" },
  {
    label: "%%{init}%%",
    insert: "%%{init: {'theme':'dark'}}%%\n$0",
    detail: "Theme init",
    kind: "kw",
  },
  // state
  { label: "state", insert: "state $0", detail: "State node", kind: "kw" },
  { label: "[*]", insert: "[*]", detail: "Start/end state", kind: "kw" },
  {
    label: "note right of",
    insert: "note right of $0\n  \nend note",
    detail: "State note",
    kind: "kw",
  },
];

// Keep highlighting tokens and typed completions in sync; curated snippets win.
const MM_ALL_COMPLETIONS = [...MM_COMPLETIONS];
const mmCompletionLabels = new Set(MM_COMPLETIONS.map((c) => c.label));
for (const token of MM_DIAGRAM) {
  if (
    MM_COMPLETIONS.some(
      (c) =>
        c.kind === "diagram" &&
        (c.label === token || c.label.startsWith(`${token} `)),
    )
  )
    continue;
  mmCompletionLabels.add(token);
  MM_ALL_COMPLETIONS.push({
    label: token,
    insert: `${token}\n  $0`,
    detail: "Diagram starter",
    kind: "diagram",
    generated: true,
  });
}
for (const token of MM_KEYWORD) {
  if (mmCompletionLabels.has(token)) continue;
  mmCompletionLabels.add(token);
  MM_ALL_COMPLETIONS.push({
    label: token,
    insert: token,
    detail: "Mermaid keyword",
    kind: "kw",
    generated: true,
  });
}

const MM_CLASS_COMPLETION_LABELS = new Set([
  "class",
  "classDef",
  "namespace",
  "cssClass",
  "callback",
  "link",
  "note for",
  "style",
  "click",
  "direction",
  "%% comment",
  "%%{init}%%",
]);

/** Reserved words — never offered as document IDs. */
const MM_RESERVED = new Set([
  ...MM_DIAGRAM,
  ...MM_KEYWORD,
  "as",
  "end",
  "and",
  "else",
  "title",
  "dateFormat",
  "true",
  "false",
  "null",
  "root",
  "commit",
  "branch",
  "checkout",
  "merge",
  "ID",
  "Name",
  "State",
  "Group",
  "label",
  "condition",
  "text",
]);

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
    if (MM_DIAGRAM.has(id)) return;
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

/** Auto-close pairs (VS Code-lite). No multi-cursor / smart quotes. */
const MM_PAIRS = {
  "[": "]",
  "(": ")",
  "{": "}",
  '"': '"',
  "'": "'",
};

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
          c.kind === "class" && c.label.includes(" ") && c.label.startsWith(phrase),
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

/** Approximate caret pixel position inside a textarea (mirror technique). */
function caretClientOffset(ta, pos) {
  const div = document.createElement("div");
  const style = window.getComputedStyle(ta);
  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "whiteSpace",
  ];
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre";
  div.style.top = "0";
  div.style.left = "-9999px";
  for (const prop of props) {
    div.style[prop] = style[prop];
  }
  div.style.width = `${ta.clientWidth}px`;
  div.style.height = "auto";
  div.style.overflow = "hidden";

  const text = ta.value.slice(0, pos);
  div.textContent = text;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  div.appendChild(marker);
  document.body.appendChild(div);
  const top = marker.offsetTop - ta.scrollTop;
  const left = marker.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}

/**
 * Overlay editor: highlighted layer + transparent textarea (Hermes-style
 * dual surface without CodeMirror import).
 *
 * Hotkeys use e.code (KeyZ/KeyX/…) so they work on any keyboard layout
 * (RU/EN/…). Native textarea undo is unreliable with controlled value —
 * we keep our own history stack.
 *
 * Line ops (VS Code-like):
 *  - mod+x / mod+c with empty selection → cut/copy whole line
 *  - mod+shift+k → delete line (no clipboard)
 *  - mod+z / mod+shift+z / mod+y → undo / redo
 *
 * Completions:
 *  - auto after 1+ chars of a word
 *  - Ctrl/Cmd+Space to open
 *  - ↑↓ / Enter|Tab / Esc
 */
function MermaidEditor({ value, onChange, disabled, placeholder }) {
  const preRef = useRef(null);
  const taRef = useRef(null);
  const rootRef = useRef(null);
  const pendingCaret = useRef(null);
  const [cm, setCm] = useState(
    /** @type {null | { items: MmCompletion[], idx: number, start: number, end: number, x: number, y: number }} */ (
      null
    ),
  );
  const cmRef = useRef(cm);
  cmRef.current = cm;
  const listRef = useRef(null);

  // Keep highlighted completion visible when navigating with arrows.
  useEffect(() => {
    if (!cm || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-cm-idx="${cm.idx}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [cm?.idx, cm?.items?.length]);
  const history = useRef({
    stack: [value || ""],
    idx: 0,
    lastEmitted: value || "",
    applying: false,
    coalesceAt: 0,
  });

  // Overlay highlight — memo on value + theme flag (cheap tokenizer).
  const darkUi = isDarkUi();
  const html = useMemo(
    () => highlightMermaidHtml(value || "", darkUi),
    [value, darkUi],
  );

  // Sync history when parent changes value externally (file switch, etc.).
  useEffect(() => {
    const h = history.current;
    const v = value || "";
    if (h.applying) {
      h.applying = false;
      h.lastEmitted = v;
      return;
    }
    if (v === h.lastEmitted) return;
    h.stack = [v];
    h.idx = 0;
    h.lastEmitted = v;
    h.coalesceAt = 0;
  }, [value]);

  useEffect(() => {
    const ta = taRef.current;
    const pos = pendingCaret.current;
    if (!ta || pos == null) return;
    pendingCaret.current = null;
    const clamped = Math.max(0, Math.min(pos, (value || "").length));
    try {
      ta.setSelectionRange(clamped, clamped);
    } catch {
      /* ok */
    }
  }, [value]);

  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    if (cmRef.current) setCm(null);
  };

  const pushHistory = (next, { coalesce = false } = {}) => {
    const h = history.current;
    const now = Date.now();
    // Truncate redo branch
    if (h.idx < h.stack.length - 1) {
      h.stack = h.stack.slice(0, h.idx + 1);
    }
    const top = h.stack[h.stack.length - 1];
    if (top === next) {
      h.lastEmitted = next;
      return;
    }
    // Coalesce rapid typing into one undo step (~400ms idle window).
    if (
      coalesce &&
      h.coalesceAt &&
      now - h.coalesceAt < 400 &&
      h.stack.length > 0
    ) {
      h.stack[h.stack.length - 1] = next;
    } else {
      h.stack.push(next);
      if (h.stack.length > 250) {
        h.stack.shift();
      } else {
        h.idx = h.stack.length - 1;
      }
      h.idx = h.stack.length - 1;
    }
    h.coalesceAt = coalesce ? now : 0;
    h.lastEmitted = next;
  };

  const emit = (next, caret, opts) => {
    pushHistory(next, opts);
    if (caret != null) pendingCaret.current = caret;
    onChange?.({ target: { value: next } });
  };

  const applyHistoryTo = (idx) => {
    const h = history.current;
    if (idx < 0 || idx >= h.stack.length) return;
    h.idx = idx;
    const next = h.stack[idx];
    h.applying = true;
    h.lastEmitted = next;
    h.coalesceAt = 0;
    pendingCaret.current = next.length;
    onChange?.({ target: { value: next } });
  };

  const undo = () => {
    const h = history.current;
    if (h.idx <= 0) return;
    applyHistoryTo(h.idx - 1);
  };

  const redo = () => {
    const h = history.current;
    if (h.idx >= h.stack.length - 1) return;
    applyHistoryTo(h.idx + 1);
  };

  const lineRange = (text, pos) => {
    const start = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl + 1;
    return { start, end };
  };

  const writeClip = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  };

  const openCompletions = (text, pos, force) => {
    const ta = taRef.current;
    const root = rootRef.current;
    if (!ta || !root) return;
    const { items, replaceStart, replaceEnd } = mermaidCompletions(
      text,
      pos,
      !!force,
    );
    if (!items.length) {
      setCm(null);
      return;
    }
    const prefix = text.slice(replaceStart, replaceEnd);
    if (!force && prefix.length < 1) {
      setCm(null);
      return;
    }
    const off = caretClientOffset(ta, pos);
    const pad = 12;
    const next = {
      items,
      idx: 0,
      start: replaceStart,
      end: replaceEnd,
      x: Math.max(4, Math.min(off.left + pad, root.clientWidth - 240)),
      y: Math.max(4, off.top + pad + 18),
    };
    cmRef.current = next;
    setCm(next);
  };

  const acceptCompletion = (item) => {
    const cur = cmRef.current;
    const ta = taRef.current;
    if (!cur || !ta) return;
    const text = value || "";
    const before = text.slice(0, cur.start);
    const after = text.slice(cur.end);
    const { text: insert, caretInInsert } = expandInsert(item.insert);
    const next = before + insert + after;
    const caret = before.length + caretInInsert;
    setCm(null);
    history.current.coalesceAt = 0;
    emit(next, caret);
    requestAnimationFrame(() => ta.focus());
  };

  const onInputChange = (e) => {
    const next = e.target.value;
    pushHistory(next, { coalesce: true });
    history.current.lastEmitted = next;
    onChange?.(e);
    if (disabled) return;
    const ta = e.target;
    const pos = ta.selectionStart ?? next.length;
    requestAnimationFrame(() => openCompletions(next, pos, false));
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const ta = taRef.current;
    if (!ta) return;
    const text = value || "";
    const mod = e.metaKey || e.ctrlKey;
    const popup = cmRef.current;
    // Physical key — layout-independent (RU/EN/…).
    const code = e.code;

    // --- completion popup navigation (↑↓ / Enter|Tab / Esc) ---
    if (popup && popup.items.length) {
      const isDown = code === "ArrowDown" || e.key === "ArrowDown";
      const isUp = code === "ArrowUp" || e.key === "ArrowUp";
      if (isDown || isUp) {
        e.preventDefault();
        e.stopPropagation();
        const n = popup.items.length;
        const nextIdx = isDown ? (popup.idx + 1) % n : (popup.idx - 1 + n) % n;
        const next = { ...popup, idx: nextIdx };
        // Update ref immediately so rapid key-repeat advances correctly
        // before React re-renders.
        cmRef.current = next;
        setCm(next);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        acceptCompletion(popup.items[popup.idx] || popup.items[0]);
        return;
      }
      if (e.key === "Escape" || code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cmRef.current = null;
        setCm(null);
        return;
      }
    }

    // Ctrl/Cmd+Space — open completions
    if (mod && !e.altKey && (code === "Space" || e.key === " ")) {
      e.preventDefault();
      e.stopPropagation();
      openCompletions(text, ta.selectionStart ?? 0, true);
      return;
    }

    // Undo / Redo — must run before early-return; layout-independent via e.code
    if (mod && !e.altKey && code === "KeyZ" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setCm(null);
      undo();
      return;
    }
    if (
      mod &&
      !e.altKey &&
      ((code === "KeyZ" && e.shiftKey) || code === "KeyY")
    ) {
      e.preventDefault();
      e.stopPropagation();
      setCm(null);
      redo();
      return;
    }

    if (!mod || e.altKey) {
      if (
        popup &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "Home" ||
          e.key === "End")
      ) {
        setCm(null);
      }

      // Auto-close / wrap / type-through / empty-pair backspace (no mod/alt).
      if (!mod && !e.altKey) {
        const selStart = ta.selectionStart ?? 0;
        const selEnd = ta.selectionEnd ?? 0;
        if (e.key === "Backspace") {
          const pairBs = applyPairBackspace(text, selStart, selEnd);
          if (pairBs) {
            e.preventDefault();
            e.stopPropagation();
            setCm(null);
            history.current.coalesceAt = 0;
            emit(pairBs.next, pairBs.caret);
            return;
          }
        } else {
          const pair = applyAutoPair(text, selStart, selEnd, e.key);
          if (pair) {
            e.preventDefault();
            e.stopPropagation();
            setCm(null);
            history.current.coalesceAt = 0;
            emit(pair.next, pair.caret);
            if (pair.sel) {
              const [a, b] = pair.sel;
              requestAnimationFrame(() => {
                try {
                  ta.setSelectionRange(a, b);
                } catch {
                  /* ok */
                }
              });
            }
            return;
          }
        }
      }
      return;
    }

    const selStart = ta.selectionStart ?? 0;
    const selEnd = ta.selectionEnd ?? 0;
    const hasSel = selStart !== selEnd;

    // Cut
    if (code === "KeyX" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setCm(null);
      history.current.coalesceAt = 0;
      if (hasSel) {
        void writeClip(text.slice(selStart, selEnd));
        emit(text.slice(0, selStart) + text.slice(selEnd), selStart);
        return;
      }
      const { start, end } = lineRange(text, selStart);
      void writeClip(text.slice(start, end));
      emit(
        text.slice(0, start) + text.slice(end),
        Math.min(start, text.length - (end - start)),
      );
      return;
    }

    // Copy line
    if (code === "KeyC" && !e.shiftKey) {
      if (hasSel) return;
      e.preventDefault();
      e.stopPropagation();
      const { start, end } = lineRange(text, selStart);
      void writeClip(text.slice(start, end));
      return;
    }

    // Delete line
    if (code === "KeyK" && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setCm(null);
      history.current.coalesceAt = 0;
      const from = hasSel ? Math.min(selStart, selEnd) : selStart;
      const to = hasSel ? Math.max(selStart, selEnd) : selStart;
      const start = lineRange(text, from).start;
      const end = lineRange(text, Math.max(from, to - (to > from ? 1 : 0))).end;
      emit(
        text.slice(0, start) + text.slice(end),
        Math.min(start, text.length - (end - start)),
      );
      return;
    }

    // Duplicate
    if (code === "KeyD" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setCm(null);
      history.current.coalesceAt = 0;
      if (hasSel) {
        const selected = text.slice(selStart, selEnd);
        emit(
          text.slice(0, selEnd) + selected + text.slice(selEnd),
          selEnd + selected.length,
        );
        requestAnimationFrame(() => {
          try {
            ta.setSelectionRange(selEnd, selEnd + selected.length);
          } catch {
            /* ok */
          }
        });
        return;
      }
      const { start, end } = lineRange(text, selStart);
      const line = text.slice(start, end);
      emit(text.slice(0, end) + line + text.slice(end), selStart + line.length);
    }
  };

  const shared =
    "box-border absolute inset-0 m-0 resize-none overflow-auto whitespace-pre border-0 p-3 font-mono text-[12px] leading-5 outline-none";

  return jsxs("div", {
    ref: rootRef,
    className: "relative min-h-0 flex-1 bg-(--ui-bg-editor)",
    children: [
      jsx("pre", {
        ref: preRef,
        "aria-hidden": true,
        className: cn(
          shared,
          "pointer-events-none z-0 bg-transparent",
          !value && "opacity-0",
        ),
        style: {
          fontFamily: EDITOR_FONT,
          color: isDarkUi() ? GH_DARK.fg : GH_LIGHT.fg,
          tabSize: 2,
        },
        dangerouslySetInnerHTML: {
          __html: html || (value ? escHtml(value) : "&nbsp;"),
        },
      }),
      !value
        ? jsx("div", {
            className:
              "pointer-events-none absolute inset-0 z-0 p-3 font-mono text-[12px] leading-5 text-(--ui-text-quaternary)",
            style: { fontFamily: EDITOR_FONT },
            children: placeholder || "flowchart TD\n  A --> B",
          })
        : null,
      jsx("textarea", {
        ref: taRef,
        value: value,
        disabled: !!disabled,
        spellCheck: false,
        autoCapitalize: "off",
        autoCorrect: "off",
        autoComplete: "off",
        placeholder: "",
        onChange: onInputChange,
        onPaste: (e) => {
          // Normalize + single history path (parent setSource around history was resetting stack).
          const clip = e.clipboardData?.getData("text");
          if (!clip) return;
          e.preventDefault();
          e.stopPropagation();
          const ta = taRef.current;
          const text = value || "";
          const start = ta?.selectionStart ?? text.length;
          const end = ta?.selectionEnd ?? start;
          const merged = text.slice(0, start) + clip + text.slice(end);
          const next = normalizeMermaidSource(merged);
          // Caret after inserted (normalized) region — not EOF-only.
          const inserted = next.length - (text.length - (end - start));
          const caret = Math.max(
            0,
            Math.min(start + Math.max(0, inserted), next.length),
          );
          setCm(null);
          emit(next, caret, { coalesce: false });
        },
        onKeyDown,
        onScroll: syncScroll,
        onBlur: () => {
          setTimeout(() => setCm(null), 150);
        },
        className: cn(
          shared,
          "z-10 bg-transparent text-transparent",
          "selection:bg-(--ui-accent)/30",
          disabled && "cursor-default opacity-60",
        ),
        style: {
          fontFamily: EDITOR_FONT,
          caretColor: "var(--ui-text-primary)",
          tabSize: 2,
          WebkitTextFillColor: "transparent",
        },
      }),
      cm && cm.items.length
        ? jsx("div", {
            ref: listRef,
            role: "listbox",
            "aria-activedescendant": `mm-cm-${cm.idx}`,
            "aria-label": "Completions",
            className:
              "absolute z-30 max-h-56 min-w-52 max-w-80 overflow-auto rounded-[6px] border border-(--ui-stroke-secondary)/50 bg-(--ui-bg-primary) py-1 text-xs shadow-lg",
            style: { left: cm.x, top: cm.y },
            onMouseDown: (e) => e.preventDefault(),
            children: cm.items.map((item, i) => {
              const selected = i === cm.idx;
              return jsxs(
                "div",
                {
                  id: `mm-cm-${i}`,
                  role: "option",
                  "data-cm-idx": String(i),
                  "aria-selected": selected,
                  className: cn(
                    "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left normal-case",
                    selected
                      ? "text-foreground"
                      : "text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground",
                  ),
                  style: selected
                    ? {
                        background:
                          "color-mix(in oklab, var(--ui-accent) 32%, var(--ui-bg-tertiary, transparent))",
                        boxShadow: "inset 2px 0 0 var(--ui-accent)",
                      }
                    : undefined,
                  onMouseEnter: () => {
                    const cur = cmRef.current;
                    if (!cur || cur.idx === i) return;
                    const next = { ...cur, idx: i };
                    cmRef.current = next;
                    setCm(next);
                  },
                  onMouseDown: (e) => {
                    e.preventDefault();
                    acceptCompletion(item);
                  },
                  children: [
                    jsx("span", {
                      className: cn(
                        "w-12 shrink-0 text-[0.65rem] uppercase tracking-wide",
                        selected
                          ? "text-(--ui-accent)"
                          : "text-(--ui-text-quaternary)",
                      ),
                      children: item.kind || "",
                    }),
                    jsx("span", {
                      className: cn(
                        "min-w-0 flex-1 truncate font-mono text-[0.75rem]",
                        selected
                          ? "font-medium text-foreground"
                          : "text-foreground",
                      ),
                      children: item.label,
                    }),
                    item.detail
                      ? jsx("span", {
                          className:
                            "max-w-[40%] shrink-0 truncate text-[0.65rem] text-(--ui-text-quaternary)",
                          children: item.detail,
                        })
                      : null,
                  ],
                },
                item.kind + ":" + item.label + ":" + i,
              );
            }),
          })
        : null,
    ],
  });
}

// ---------------------------------------------------------------------------
// Theme + remote SVG render
// ---------------------------------------------------------------------------

