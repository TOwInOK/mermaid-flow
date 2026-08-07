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
  "graph",
  "sequenceDiagram",
  "classDiagram",
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
  "xychart",
  "xychart-beta",
  "block-beta",
  "sankey-beta",
  "packet-beta",
  "architecture-beta",
  "radar-beta",
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

/** @typedef {{ label: string, insert: string, detail?: string, kind?: string }} MmCompletion */

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
  // sequence
  {
    label: "participant",
    insert: "participant A as $0",
    detail: "Sequence participant",
    kind: "seq",
  },
  {
    label: "actor",
    insert: "actor U as $0",
    detail: "Sequence actor",
    kind: "seq",
  },
  {
    label: "Note right of",
    insert: "Note right of A: $0",
    detail: "Sequence note",
    kind: "seq",
  },
  {
    label: "Note left of",
    insert: "Note left of A: $0",
    detail: "Sequence note",
    kind: "seq",
  },
  {
    label: "Note over",
    insert: "Note over A,B: $0",
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
  // flowchart edges / nodes — $0 inside label
  { label: "-->", insert: "-->", detail: "Arrow", kind: "edge" },
  { label: "---", insert: "---", detail: "Link (no arrow)", kind: "edge" },
  { label: "-.->", insert: "-.->", detail: "Dotted arrow", kind: "edge" },
  { label: "==>", insert: "==>", detail: "Thick arrow", kind: "edge" },
  {
    label: "-->|label|",
    insert: "-->|$0| ",
    detail: "Labeled arrow",
    kind: "edge",
  },
  {
    label: "node [rect]",
    insert: 'ID["$0"]',
    detail: "Rectangle node",
    kind: "node",
  },
  {
    label: "node (round)",
    insert: 'ID("$0")',
    detail: "Rounded node",
    kind: "node",
  },
  {
    label: "node ([stadium])",
    insert: 'ID(["$0"])',
    detail: "Stadium node",
    kind: "node",
  },
  {
    label: "node {rhombus}",
    insert: 'ID{"$0"}',
    detail: "Decision node",
    kind: "node",
  },
  {
    label: "node [(db)]",
    insert: 'ID[("$0")]',
    detail: "Cylinder / DB",
    kind: "node",
  },
  {
    label: "node ((circle))",
    insert: 'ID(("$0"))',
    detail: "Circle node",
    kind: "node",
  },
  // style / misc
  {
    label: "classDef",
    insert: "classDef name fill:#f9f,stroke:#333",
    detail: "CSS class",
    kind: "kw",
  },
  {
    label: "style",
    insert: "style ID fill:#bbf,stroke:#333",
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
    insert: 'click ID href "$0"',
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
    insert: "note right of State\n  $0\nend note",
    detail: "State note",
    kind: "kw",
  },
];

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

function wordPrefixAt(text, pos) {
  let j = pos;
  while (j > 0 && /[A-Za-z0-9_@.*%-]/.test(text[j - 1])) j--;
  return { start: j, prefix: text.slice(j, pos) };
}

function detectDiagramKind(text) {
  const head = text.slice(0, 400);
  if (/sequenceDiagram/i.test(head)) return "sequence";
  if (/stateDiagram/i.test(head)) return "state";
  if (/classDiagram/i.test(head)) return "class";
  if (/erDiagram/i.test(head)) return "er";
  if (/flowchart|^\s*graph\b/im.test(head)) return "flow";
  if (/gantt/i.test(head)) return "gantt";
  return "";
}

/**
 * Completion list for caret position.
 * @param {boolean} [force] full catalog (Ctrl+Space); else context-filtered.
 * @returns {{ items: MmCompletion[], replaceStart: number, replaceEnd: number }}
 */
function mermaidCompletions(text, pos, force = false) {
  const { start, prefix } = wordPrefixAt(text, pos);
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const lineBefore = text.slice(lineStart, start);
  const trimmedDoc = text.trim();
  const kind = detectDiagramKind(text);
  const p = prefix.toLowerCase();

  /** @type {MmCompletion[]} */
  let pool = MM_COMPLETIONS;

  // Ctrl+Space → entire snippet catalog. Typing → context-narrowed pool.
  if (!force) {
    if (!trimmedDoc || (lineStart === 0 && !lineBefore.trim() && start === 0)) {
      pool = MM_COMPLETIONS.filter((c) => c.kind === "diagram");
    } else if (/^(flowchart|graph)\s*$/i.test(lineBefore)) {
      pool = MM_COMPLETIONS.filter((c) => c.kind === "dir");
    } else if (kind === "sequence") {
      pool = MM_COMPLETIONS.filter(
        (c) => c.kind === "seq" || c.kind === "kw" || c.kind === "edge",
      );
    } else if (kind === "flow") {
      pool = MM_COMPLETIONS.filter(
        (c) =>
          c.kind === "kw" ||
          c.kind === "edge" ||
          c.kind === "node" ||
          c.kind === "dir",
      );
    } else if (kind === "state") {
      pool = MM_COMPLETIONS.filter(
        (c) =>
          c.kind === "kw" ||
          c.label.startsWith("state") ||
          c.label === "[*]" ||
          c.label.startsWith("note"),
      );
    }
  }

  // Existing IDs from the open diagram (Qora, Bot, …) — not labels.
  const docIds = extractDocIds(text);
  /** @type {MmCompletion[]} */
  const idItems = docIds.map((id) => ({
    label: id,
    insert: id,
    detail: "from diagram",
    kind: "id",
  }));

  const match = (c) => {
    // Full catalog on force still respects typed prefix if any.
    if (!p) return true;
    const lab = c.label.toLowerCase();
    const ins = c.insert.toLowerCase().replace(/\$0/g, "");
    return lab.startsWith(p) || lab.includes(p) || ins.startsWith(p);
  };

  const idsMatched = idItems.filter(match);
  const kwMatched = pool.filter(match);

  // IDs first, then snippets. Full list on Ctrl+Space; compact while typing.
  const cap = force ? 200 : 16;
  const items = [...idsMatched, ...kwMatched].slice(0, cap);

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
    className: "relative min-h-0 flex-1",
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
      jsx("div", {
        className:
          "pointer-events-none absolute bottom-1 right-2 z-20 text-[0.65rem] text-(--ui-text-quaternary)/80",
        children: "↑↓ · Tab · Ctrl+Space",
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Theme + remote SVG render
// ---------------------------------------------------------------------------

