// Runtime-independent constants and immutable Mermaid language data.

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.12;
const SPLIT_MIN = 18;
const SPLIT_MAX = 82;
const DEFAULT_REL_DIR = "docs/mermaid";
const DEFAULT_SOURCE = `flowchart TD
  A[Start] --> B[Next]
`;

/** Live zoom actions published by SvgCanvas → PREVIEW header. */
const $previewChrome = atom(null);
const $flowStatus = atom({ state: "idle", detail: "" });

const STORAGE_VIEW = "view";
const STORAGE_SPLIT = "splitPct"; // 0..100 first-pane share
const STORAGE_SPLIT_ORIENT = "splitOrient"; // vertical | horizontal
const STORAGE_DIRS = "projectDirs"; // { [cwd]: relativeOrAbsolute }
const STORAGE_ACTIVE = "projectActive"; // { [cwd]: fileName }

// Semantic token colors are the documented SDK exception: CodeMirror, Shiki,
// and syntax palette tokens are not public to disk plugins.
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

/** Auto-close pairs (VS Code-lite). No multi-cursor / smart quotes. */
const MM_PAIRS = {
  "[": "]",
  "(": ")",
  "{": "}",
  '"': '"',
  "'": "'",
};
