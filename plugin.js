/**
 * mermaid-flow — project-backed Mermaid editor for Hermes Desktop.
 *
 * ~/.hermes/desktop-plugins/mermaid-flow/plugin.js
 * id MUST match folder name.
 *
 * Diagrams live on disk under a per-project folder (default: docs/mermaid).
 * FS via window.hermesDesktop (readDir / readFileText / writeTextFile /
 * selectPaths / openDir / revealPath) — not part of @hermes/plugin-sdk, but
 * available to disk plugins in the renderer (full app authority).
 */

import {
  Badge,
  Button,
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  GlyphSpinner,
  haptic,
  host,
  Input,
  KEYBINDS_AREA,
  PALETTE_AREA,
  ROUTES_AREA,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SIDEBAR_NAV_AREA,
  Tip,
  useValue,
  atom
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ZOOM_MIN = 0.15
const ZOOM_MAX = 6
const ZOOM_STEP = 1.12
const DEFAULT_REL_DIR = 'docs/mermaid'
const DEFAULT_SOURCE = `flowchart TD
  A[Start] --> B[Next]
`

/** Live zoom actions published by SvgCanvas → PREVIEW header. */
const $previewChrome = atom(null)

const STORAGE_VIEW = 'view'
const STORAGE_SPLIT = 'splitPct' // 0..100 left pane share
const STORAGE_DIRS = 'projectDirs' // { [cwd]: relativeOrAbsolute }
const STORAGE_ACTIVE = 'projectActive' // { [cwd]: fileName }

// ---------------------------------------------------------------------------
// Plugin-scoped handles (set in register)
// ---------------------------------------------------------------------------

/** @type {{ get: Function, set: Function, remove: Function } | null} */
let storage = null
/** @type {{ openExternal: Function, writeClipboard: Function, revealPath: Function } | null} */
let os = null

// ---------------------------------------------------------------------------
// Path + desktop FS helpers
// ---------------------------------------------------------------------------

function bridge() {
  return typeof window !== 'undefined' ? window.hermesDesktop : null
}

function joinPath(a, b) {
  if (!a) return b || ''
  if (!b) return a
  const left = String(a).replace(/[/\\]+$/, '')
  const right = String(b).replace(/^[/\\]+/, '')
  const sep = left.includes('\\') && !left.includes('/') ? '\\' : '/'
  return `${left}${sep}${right}`
}

function baseName(p) {
  const s = String(p || '').replace(/[/\\]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

function isAbsPath(p) {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(String(p || ''))
}

function resolveDiagramsDir(cwd, configured) {
  const conf = (configured || DEFAULT_REL_DIR).trim() || DEFAULT_REL_DIR
  if (isAbsPath(conf)) return conf
  if (!cwd) return conf
  return joinPath(cwd, conf)
}

function slugifyName(raw) {
  // Keep letters (incl. non-ASCII), digits, . _ - ; strip path/illegal chars.
  // Avoid \p{} — some Electron builds reject Unicode properties in char classes.
  const s = String(raw || '')
    .trim()
    .replace(/\.(mmd|md|mermaid)$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'diagram'
}

function ensureMmdName(name) {
  const base = slugifyName(name)
  return /\.mmd$/i.test(base) ? base : `${base}.mmd`
}

async function fsReadDir(dir) {
  const b = bridge()
  if (!b?.readDir) throw new Error('readDir unavailable')
  return b.readDir(dir)
}

async function fsReadText(path) {
  const b = bridge()
  if (!b?.readFileText) throw new Error('readFileText unavailable')
  const res = await b.readFileText(path)
  return res?.text ?? ''
}

async function fsWriteText(path, content) {
  const b = bridge()
  if (!b?.writeTextFile) throw new Error('writeTextFile unavailable')
  return b.writeTextFile(path, content)
}

/** Ensure dir exists. open:true → openDir (mkdir + FM). open:false → silent mkdir if bridge has it; else one openDir (FM unavoidable — no silent mkdir on hermesDesktop). */
async function fsEnsureDir(dir, { open = false } = {}) {
  const b = bridge()
  if (!b) throw new Error('Desktop bridge unavailable')

  try {
    const listed = await b.readDir(dir)
    if (!listed?.error) {
      if (open && b.openDir) await b.openDir(dir)
      return true
    }
  } catch {
    /* create below */
  }

  // Silent mkdir ladder if present on bridge (none on current Desktop types).
  const silent =
    (typeof b.mkdir === 'function' && b.mkdir) ||
    (typeof b.ensureDir === 'function' && b.ensureDir) ||
    (typeof b.createDir === 'function' && b.createDir) ||
    null
  if (silent) {
    const res = await silent.call(b, dir)
    if (res && res.ok === false) throw new Error(res.error || 'mkdir failed')
    if (open && b.openDir) await b.openDir(dir)
    return true
  }

  if (!b.openDir) throw new Error('Cannot create folder (openDir missing)')
  // ponytail: no silent mkdir on bridge; openDir = mkdir -p + FM (one call max)
  const res = await b.openDir(dir)
  if (res && res.ok === false) throw new Error(res.error || 'mkdir failed')
  return true
}

async function listDiagramFiles(dir) {
  const res = await fsReadDir(dir)
  if (res?.error) {
    const err = new Error(res.error)
    err.code = 'LIST'
    throw err
  }
  const entries = Array.isArray(res?.entries) ? res.entries : []
  return entries
    .filter((e) => !e.isDirectory && /\.(mmd|mermaid|md)$/i.test(e.name || e.path || ''))
    .map((e) => {
      const name = e.name || baseName(e.path)
      const path = e.path || joinPath(dir, name)
      return { name, path, label: name.replace(/\.(mmd|mermaid|md)$/i, '') }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Pull mermaid body from raw .mmd or fenced .md */
function extractSource(text, fileName) {
  const raw = String(text ?? '')
  if (/\.md$/i.test(fileName || '')) {
    const m = raw.match(/```mermaid\s*([\s\S]*?)```/i)
    if (m) return normalizeMermaidSource(m[1])
  }
  return normalizeMermaidSource(raw)
}

/**
 * Soft-normalize paste / editor body so common copy mistakes still render:
 *  - strip ```mermaid fences
 *  - unicode arrows → ASCII
 *  - bare node edges without diagram header → flowchart TD
 */
function normalizeMermaidSource(raw) {
  let s = String(raw ?? '').replace(/\r\n/g, '\n')

  // whole-buffer fence
  const whole = s.match(/^\s*```(?:mermaid)?\s*\n([\s\S]*?)\n```\s*$/i)
  if (whole) s = whole[1]
  else if (/```mermaid/i.test(s)) {
    const m = s.match(/```mermaid\s*([\s\S]*?)```/i)
    if (m) s = m[1]
  }

  s = s
    .replace(/\u2192/g, '-->') // →
    .replace(/\u27f6/g, '-->') // ⟶
    .replace(/\u21d2/g, '==>') // ⇒
    .replace(/<br\s*>/gi, '<br/>')

  const trimmed = s.trim()
  if (!trimmed) return ''

  const DIAGRAM_START =
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|quadrantChart|requirementDiagram|xychart(?:-beta)?|block-beta|sankey(?:-beta)?|packet(?:-beta)?|architecture(?:-beta)?|radar(?:-beta)?)\b/i

  const first = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%'))

  if (first && !DIAGRAM_START.test(first)) {
    // body looks like flowchart edges/nodes without a header
    if (/-->|---|==>|-\.-|subgraph|\[[^\]]*]|\{[^}]*\}|\(\([^)]*\)\)/.test(trimmed)) {
      s = `flowchart TD\n${trimmed}`
    }
  }

  return String(s).replace(/\s+$/, '') + '\n'
}

function packSource(source, fileName) {
  const body = normalizeMermaidSource(source)
  if (/\.md$/i.test(fileName || '')) {
    return '```mermaid\n' + body.trim() + '\n```\n'
  }
  return body
}

function isMermaidPath(path) {
  return /\.(mmd|mermaid|md)$/i.test(String(path || ''))
}

/**
 * Hermes files tree drag payload:
 *   application/x-hermes-paths = JSON [{ isDirectory, path }]
 *   text/plain = absolute path
 */
function pathsFromDataTransfer(dt) {
  if (!dt) return []
  const out = []

  const hermes = dt.getData('application/x-hermes-paths')
  if (hermes) {
    try {
      const parsed = JSON.parse(hermes)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.path === 'string' && !item.isDirectory) out.push(item.path)
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!out.length) {
    const plain = dt.getData('text/plain')?.trim()
    if (plain && (plain.startsWith('/') || /^[A-Za-z]:[\\/]/.test(plain))) out.push(plain)
  }

  // OS / external file drag
  if (dt.files && dt.files.length) {
    for (const f of dt.files) {
      const p = f.path || (typeof window !== 'undefined' && window.hermesDesktop?.getPathForFile?.(f))
      if (p) out.push(p)
    }
  }

  return [...new Set(out.filter(Boolean))]
}

function hasHermesFileDrag(dt) {
  if (!dt) return false
  const types = dt.types ? Array.from(dt.types) : []
  if (types.includes('application/x-hermes-paths')) return true
  if (types.includes('Files')) return true
  if (types.includes('text/plain')) return true
  return false
}

// ---------------------------------------------------------------------------
// Mermaid syntax highlight — mirrors Hermes code-editor palette
// (github-light-default / github-dark — see code-editor-theme.ts).
// Disk plugins can't import CodeMirror/Shiki; same token colors + overlay editor.
// ---------------------------------------------------------------------------

const GH_DARK = {
  fg: '#e6edf3',
  comment: '#8b949e',
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  entity: '#d2a8ff',
  type: '#ffa657',
  tag: '#7ee787',
  constant: '#79c0ff'
}

const GH_LIGHT = {
  fg: '#1f2328',
  comment: '#57606a', // Hermes bumps light comments for readability
  keyword: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  entity: '#8250df',
  type: '#953800',
  tag: '#116329',
  constant: '#0550ae'
}

const MM_DIAGRAM = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'quadrantChart',
  'requirementDiagram',
  'xychart',
  'xychart-beta',
  'block-beta',
  'sankey-beta',
  'packet-beta',
  'architecture-beta',
  'radar-beta'
])

const MM_KEYWORD = new Set([
  'subgraph',
  'end',
  'direction',
  'TB',
  'BT',
  'LR',
  'RL',
  'TD',
  'participant',
  'actor',
  'as',
  'Note',
  'note',
  'over',
  'left',
  'right',
  'of',
  'activate',
  'deactivate',
  'loop',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'critical',
  'break',
  'rect',
  'class',
  'classDef',
  'linkStyle',
  'style',
  'click',
  'callback',
  'href',
  'state',
  'fork',
  'join',
  'choice',
  'title',
  'section',
  'dateFormat',
  'axisFormat',
  'excludes',
  'includes',
  'todayMarker',
  'autonumber',
  'box',
  'accTitle',
  'accDescr'
])

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function span(color, text) {
  return `<span style="color:${color}">${escHtml(text)}</span>`
}

/**
 * Line-oriented mermaid highlighter. Returns HTML (escaped text + colored spans).
 * Palette matches Hermes CodeMirror github theme.
 */
function highlightMermaidHtml(code, dark) {
  const p = dark ? GH_DARK : GH_LIGHT
  if (!code) return ''

  const lines = code.split('\n')
  const out = []

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const trimmed = line.trimStart()

    // full-line comment (not %%{init)
    if (trimmed.startsWith('%%') && !trimmed.startsWith('%%{')) {
      out.push(span(p.comment, line))
      continue
    }

    let i = 0
    let html = ''
    const pushPlain = (chunk) => {
      if (!chunk) return
      html += escHtml(chunk)
    }

    while (i < line.length) {
      // whitespace
      if (/\s/.test(line[i])) {
        let j = i + 1
        while (j < line.length && /\s/.test(line[j])) j++
        pushPlain(line.slice(i, j))
        i = j
        continue
      }

      // inline / trailing comment
      if (line[i] === '%' && line[i + 1] === '%' && line[i + 2] !== '{') {
        html += span(p.comment, line.slice(i))
        break
      }

      // %%{ ... }%% directive
      if (line.startsWith('%%{', i)) {
        const end = line.indexOf('}%%', i)
        if (end !== -1) {
          html += span(p.comment, line.slice(i, end + 3))
          i = end + 3
          continue
        }
      }

      // quoted strings "..." or '...'
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i]
        let j = i + 1
        while (j < line.length && line[j] !== q) {
          if (line[j] === '\\') j++
          j++
        }
        if (j < line.length) j++
        html += span(p.string, line.slice(i, j))
        i = j
        continue
      }

      // bracket labels ["..."] / ["text"] already handled by quotes inside;
      // bare [...] text
      if (line[i] === '[' || line[i] === '(' || line[i] === '{') {
        const open = line[i]
        const close = open === '[' ? ']' : open === '(' ? ')' : '}'
        // shape openers like [[, [(, (( etc.
        let j = i + 1
        while (j < line.length && (line[j] === open || line[j] === '(' || line[j] === '[' || line[j] === '{')) j++
        const openChunk = line.slice(i, j)
        html += span(p.fg, openChunk)
        i = j
        // content until matching-ish close (simplified)
        let depth = 1
        let k = i
        let buf = ''
        while (k < line.length && depth > 0) {
          if (line[k] === '"' || line[k] === "'") {
            if (buf) {
              html += span(p.string, buf)
              buf = ''
            }
            const q = line[k]
            let t = k + 1
            while (t < line.length && line[t] !== q) {
              if (line[t] === '\\') t++
              t++
            }
            if (t < line.length) t++
            html += span(p.string, line.slice(k, t))
            k = t
            continue
          }
          if (line[k] === open || line[k] === '[' || line[k] === '(' || line[k] === '{') depth++
          if (line[k] === close || line[k] === ']' || line[k] === ')' || line[k] === '}') {
            depth--
            if (depth === 0) break
          }
          buf += line[k]
          k++
        }
        if (buf) html += span(p.string, buf)
        i = k
        continue
      }

      // arrows / edges
      const arrow2 = line.slice(i).match(/^(-->|---|==>|-\.->|->>|-->>|--o|--x|-\.-x|-\.-|~~>|~~|==|--)|\|[^|\n]*\|/)
      if (arrow2) {
        html += span(p.constant, arrow2[0])
        i += arrow2[0].length
        continue
      }

      // numbers
      if (/\d/.test(line[i])) {
        let j = i
        while (j < line.length && /[\d.]/.test(line[j])) j++
        html += span(p.number, line.slice(i, j))
        i = j
        continue
      }

      // identifiers / keywords
      if (/[A-Za-z_@*]/.test(line[i])) {
        let j = i + 1
        while (j < line.length && /[A-Za-z0-9_$@.*-]/.test(line[j])) j++
        const word = line.slice(i, j)
        if (MM_DIAGRAM.has(word)) html += span(p.type, word)
        else if (MM_KEYWORD.has(word)) html += span(p.keyword, word)
        else if (word === 'true' || word === 'false' || word === 'null') html += span(p.number, word)
        else html += span(p.entity, word)
        i = j
        continue
      }

      // punctuation
      html += span(p.fg, line[i])
      i++
    }

    out.push(html)
  }

  // trailing newline: split keeps last empty line — join with \n
  return out.join('\n') + (code.endsWith('\n') ? '\n' : '')
}

const EDITOR_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/** @typedef {{ label: string, insert: string, detail?: string, kind?: string }} MmCompletion */

/**
 * `$0` in insert = caret landing spot after accept (stripped on insert).
 * Prefer placing `$0` inside label quotes so you type the label immediately.
 */
/** @type {MmCompletion[]} */
const MM_COMPLETIONS = [
  // diagrams
  { label: 'flowchart TD', insert: 'flowchart TD\n  $0', detail: 'Top-down flow', kind: 'diagram' },
  { label: 'flowchart LR', insert: 'flowchart LR\n  $0', detail: 'Left-right flow', kind: 'diagram' },
  { label: 'flowchart TB', insert: 'flowchart TB\n  $0', detail: 'Top-bottom flow', kind: 'diagram' },
  { label: 'graph TD', insert: 'graph TD\n  $0', detail: 'Alias of flowchart', kind: 'diagram' },
  { label: 'sequenceDiagram', insert: 'sequenceDiagram\n  $0', detail: 'Sequence / actors', kind: 'diagram' },
  { label: 'stateDiagram-v2', insert: 'stateDiagram-v2\n  $0', detail: 'State machine', kind: 'diagram' },
  { label: 'classDiagram', insert: 'classDiagram\n  $0', detail: 'UML classes', kind: 'diagram' },
  { label: 'erDiagram', insert: 'erDiagram\n  $0', detail: 'Entity-relationship', kind: 'diagram' },
  { label: 'gantt', insert: 'gantt\n  title $0\n  dateFormat YYYY-MM-DD\n  ', detail: 'Gantt chart', kind: 'diagram' },
  { label: 'pie', insert: 'pie title $0\n  "A" : 40\n  "B" : 60\n', detail: 'Pie chart', kind: 'diagram' },
  { label: 'mindmap', insert: 'mindmap\n  root(($0))\n    A\n    B\n', detail: 'Mind map', kind: 'diagram' },
  { label: 'timeline', insert: 'timeline\n  title $0\n  ', detail: 'Timeline', kind: 'diagram' },
  { label: 'gitGraph', insert: 'gitGraph\n  commit id: "$0"\n  ', detail: 'Git graph', kind: 'diagram' },
  { label: 'journey', insert: 'journey\n  title $0\n  ', detail: 'User journey', kind: 'diagram' },
  // directions
  { label: 'TD', insert: 'TD', detail: 'Top → down', kind: 'dir' },
  { label: 'TB', insert: 'TB', detail: 'Top → bottom', kind: 'dir' },
  { label: 'BT', insert: 'BT', detail: 'Bottom → top', kind: 'dir' },
  { label: 'LR', insert: 'LR', detail: 'Left → right', kind: 'dir' },
  { label: 'RL', insert: 'RL', detail: 'Right → left', kind: 'dir' },
  // structure
  { label: 'subgraph', insert: 'subgraph id ["$0"]\n  \nend', detail: 'Group nodes', kind: 'kw' },
  { label: 'end', insert: 'end', detail: 'Close subgraph/block', kind: 'kw' },
  { label: 'direction', insert: 'direction $0', detail: 'Subgraph direction', kind: 'kw' },
  // sequence
  { label: 'participant', insert: 'participant A as $0', detail: 'Sequence participant', kind: 'seq' },
  { label: 'actor', insert: 'actor U as $0', detail: 'Sequence actor', kind: 'seq' },
  { label: 'Note right of', insert: 'Note right of A: $0', detail: 'Sequence note', kind: 'seq' },
  { label: 'Note left of', insert: 'Note left of A: $0', detail: 'Sequence note', kind: 'seq' },
  { label: 'Note over', insert: 'Note over A,B: $0', detail: 'Note over lifelines', kind: 'seq' },
  { label: 'activate', insert: 'activate $0', detail: 'Activate lifeline', kind: 'seq' },
  { label: 'deactivate', insert: 'deactivate $0', detail: 'Deactivate lifeline', kind: 'seq' },
  { label: 'loop', insert: 'loop $0\n  \nend', detail: 'Loop block', kind: 'seq' },
  { label: 'alt', insert: 'alt $0\n  \nelse\n  \nend', detail: 'Alt / else', kind: 'seq' },
  { label: 'opt', insert: 'opt $0\n  \nend', detail: 'Optional block', kind: 'seq' },
  { label: 'par', insert: 'par $0\n  \nand\n  \nend', detail: 'Parallel block', kind: 'seq' },
  { label: 'autonumber', insert: 'autonumber', detail: 'Number messages', kind: 'seq' },
  { label: 'box', insert: 'box $0\n  \nend', detail: 'Group participants', kind: 'seq' },
  // flowchart edges / nodes — $0 inside label
  { label: '-->', insert: '-->', detail: 'Arrow', kind: 'edge' },
  { label: '---', insert: '---', detail: 'Link (no arrow)', kind: 'edge' },
  { label: '-.->', insert: '-.->', detail: 'Dotted arrow', kind: 'edge' },
  { label: '==>', insert: '==>', detail: 'Thick arrow', kind: 'edge' },
  { label: '-->|label|', insert: '-->|$0| ', detail: 'Labeled arrow', kind: 'edge' },
  { label: 'node [rect]', insert: 'ID["$0"]', detail: 'Rectangle node', kind: 'node' },
  { label: 'node (round)', insert: 'ID("$0")', detail: 'Rounded node', kind: 'node' },
  { label: 'node ([stadium])', insert: 'ID(["$0"])', detail: 'Stadium node', kind: 'node' },
  { label: 'node {rhombus}', insert: 'ID{"$0"}', detail: 'Decision node', kind: 'node' },
  { label: 'node [(db)]', insert: 'ID[("$0")]', detail: 'Cylinder / DB', kind: 'node' },
  { label: 'node ((circle))', insert: 'ID(("$0"))', detail: 'Circle node', kind: 'node' },
  // style / misc
  { label: 'classDef', insert: 'classDef name fill:#f9f,stroke:#333', detail: 'CSS class', kind: 'kw' },
  { label: 'style', insert: 'style ID fill:#bbf,stroke:#333', detail: 'Inline style', kind: 'kw' },
  { label: 'linkStyle', insert: 'linkStyle 0 stroke:#f00', detail: 'Edge style', kind: 'kw' },
  { label: 'click', insert: 'click ID href "$0"', detail: 'Click handler', kind: 'kw' },
  { label: '%% comment', insert: '%% $0', detail: 'Line comment', kind: 'kw' },
  { label: '%%{init}%%', insert: "%%{init: {'theme':'dark'}}%%\n$0", detail: 'Theme init', kind: 'kw' },
  // state
  { label: 'state', insert: 'state $0', detail: 'State node', kind: 'kw' },
  { label: '[*]', insert: '[*]', detail: 'Start/end state', kind: 'kw' },
  { label: 'note right of', insert: 'note right of State\n  $0\nend note', detail: 'State note', kind: 'kw' }
]

/** Reserved words — never offered as document IDs. */
const MM_RESERVED = new Set([
  ...MM_DIAGRAM,
  ...MM_KEYWORD,
  'as',
  'end',
  'and',
  'else',
  'title',
  'dateFormat',
  'true',
  'false',
  'null',
  'root',
  'commit',
  'branch',
  'checkout',
  'merge',
  'ID',
  'Name',
  'State',
  'Group',
  'label',
  'condition',
  'text'
])

/**
 * Collect node / participant / actor IDs from the diagram source.
 * Labels (quoted strings, bracket text) are stripped first — only IDs.
 */
function extractDocIds(text) {
  let s = String(text || '')
  // strip directives + line comments
  s = s.replace(/%%\{[\s\S]*?\}%%/g, ' ')
  s = s.replace(/%%[^\n]*/g, ' ')
  // strip quoted labels
  s = s.replace(/"(?:\\.|[^"\\])*"/g, ' ')
  s = s.replace(/'(?:\\.|[^'\\])*'/g, ' ')
  // strip pipe edge labels -->|label|
  s = s.replace(/\|[^|\n]*\|/g, ' ')

  const ids = new Set()

  const add = (raw) => {
    if (!raw) return
    const id = String(raw)
    if (id.length < 1 || id.length > 64) return
    if (MM_RESERVED.has(id) || MM_RESERVED.has(id.toLowerCase())) return
    if (MM_DIAGRAM.has(id)) return
    if (!/^[A-Za-z_@][\w.-]*$/.test(id)) return
    ids.add(id)
  }

  // participant Foo / actor U / state Name
  for (const m of s.matchAll(/\b(?:participant|actor|state)\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1])
  // subgraph id
  for (const m of s.matchAll(/\bsubgraph\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1])
  // Node shapes: Foo[  Foo(  Foo{  Foo((
  for (const m of s.matchAll(/\b([A-Za-z_@][\w.-]*)\s*(?:\[|\(\(|\(|\{\{|\{)/g)) add(m[1])
  // Edges: A --> B / A->>B / A -->> B
  for (const m of s.matchAll(
    /\b([A-Za-z_@][\w.-]*)\s*(?:-->|---|==>|-\.->|->>|-->>|-\)|--\)|~~>)\s*([A-Za-z_@][\w.-]*)/g
  )) {
    add(m[1])
    add(m[2])
  }
  // style / click / class targets
  for (const m of s.matchAll(/\b(?:style|click|class)\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1])
  // activate / deactivate
  for (const m of s.matchAll(/\b(?:activate|deactivate)\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1])
  // Note … of A / Note over A,B
  for (const m of s.matchAll(/\bNote\s+(?:left|right)\s+of\s+([A-Za-z_@][\w.-]*)/gi)) add(m[1])
  for (const m of s.matchAll(/\bNote\s+over\s+([A-Za-z_@][\w.-]*)\s*(?:,\s*([A-Za-z_@][\w.-]*))?/gi)) {
    add(m[1])
    add(m[2])
  }

  return [...ids].sort((a, b) => a.localeCompare(b))
}

/** Expand insert template: strip `$0` and return caret offset inside insert. */
function expandInsert(insert) {
  const raw = String(insert ?? '')
  const idx = raw.indexOf('$0')
  if (idx === -1) return { text: raw, caretInInsert: raw.length }
  return { text: raw.slice(0, idx) + raw.slice(idx + 2), caretInInsert: idx }
}

function wordPrefixAt(text, pos) {
  let j = pos
  while (j > 0 && /[A-Za-z0-9_@.*%-]/.test(text[j - 1])) j--
  return { start: j, prefix: text.slice(j, pos) }
}

function detectDiagramKind(text) {
  const head = text.slice(0, 400)
  if (/sequenceDiagram/i.test(head)) return 'sequence'
  if (/stateDiagram/i.test(head)) return 'state'
  if (/classDiagram/i.test(head)) return 'class'
  if (/erDiagram/i.test(head)) return 'er'
  if (/flowchart|^\s*graph\b/im.test(head)) return 'flow'
  if (/gantt/i.test(head)) return 'gantt'
  return ''
}

/**
 * Completion list for caret position.
 * @param {boolean} [force] full catalog (Ctrl+Space); else context-filtered.
 * @returns {{ items: MmCompletion[], replaceStart: number, replaceEnd: number }}
 */
function mermaidCompletions(text, pos, force = false) {
  const { start, prefix } = wordPrefixAt(text, pos)
  const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const lineBefore = text.slice(lineStart, start)
  const trimmedDoc = text.trim()
  const kind = detectDiagramKind(text)
  const p = prefix.toLowerCase()

  /** @type {MmCompletion[]} */
  let pool = MM_COMPLETIONS

  // Ctrl+Space → entire snippet catalog. Typing → context-narrowed pool.
  if (!force) {
    if (!trimmedDoc || (lineStart === 0 && !lineBefore.trim() && start === 0)) {
      pool = MM_COMPLETIONS.filter((c) => c.kind === 'diagram')
    } else if (/^(flowchart|graph)\s*$/i.test(lineBefore)) {
      pool = MM_COMPLETIONS.filter((c) => c.kind === 'dir')
    } else if (kind === 'sequence') {
      pool = MM_COMPLETIONS.filter((c) => c.kind === 'seq' || c.kind === 'kw' || c.kind === 'edge')
    } else if (kind === 'flow') {
      pool = MM_COMPLETIONS.filter((c) => c.kind === 'kw' || c.kind === 'edge' || c.kind === 'node' || c.kind === 'dir')
    } else if (kind === 'state') {
      pool = MM_COMPLETIONS.filter(
        (c) => c.kind === 'kw' || c.label.startsWith('state') || c.label === '[*]' || c.label.startsWith('note')
      )
    }
  }

  // Existing IDs from the open diagram (Qora, Bot, …) — not labels.
  const docIds = extractDocIds(text)
  /** @type {MmCompletion[]} */
  const idItems = docIds.map((id) => ({
    label: id,
    insert: id,
    detail: 'from diagram',
    kind: 'id'
  }))

  const match = (c) => {
    // Full catalog on force still respects typed prefix if any.
    if (!p) return true
    const lab = c.label.toLowerCase()
    const ins = c.insert.toLowerCase().replace(/\$0/g, '')
    return lab.startsWith(p) || lab.includes(p) || ins.startsWith(p)
  }

  const idsMatched = idItems.filter(match)
  const kwMatched = pool.filter(match)

  // IDs first, then snippets. Full list on Ctrl+Space; compact while typing.
  const cap = force ? 200 : 16
  const items = [...idsMatched, ...kwMatched].slice(0, cap)

  return { items, replaceStart: start, replaceEnd: pos }
}

/** Approximate caret pixel position inside a textarea (mirror technique). */
function caretClientOffset(ta, pos) {
  const div = document.createElement('div')
  const style = window.getComputedStyle(ta)
  const props = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'whiteSpace'
  ]
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre'
  div.style.top = '0'
  div.style.left = '-9999px'
  for (const prop of props) {
    div.style[prop] = style[prop]
  }
  div.style.width = `${ta.clientWidth}px`
  div.style.height = 'auto'
  div.style.overflow = 'hidden'

  const text = ta.value.slice(0, pos)
  div.textContent = text
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  div.appendChild(marker)
  document.body.appendChild(div)
  const top = marker.offsetTop - ta.scrollTop
  const left = marker.offsetLeft - ta.scrollLeft
  document.body.removeChild(div)
  return { top, left }
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
  const preRef = useRef(null)
  const taRef = useRef(null)
  const rootRef = useRef(null)
  const pendingCaret = useRef(null)
  const [cm, setCm] = useState(
    /** @type {null | { items: MmCompletion[], idx: number, start: number, end: number, x: number, y: number }} */ (
      null
    )
  )
  const cmRef = useRef(cm)
  cmRef.current = cm
  const listRef = useRef(null)

  // Keep highlighted completion visible when navigating with arrows.
  useEffect(() => {
    if (!cm || !listRef.current) return
    const el = listRef.current.querySelector(`[data-cm-idx="${cm.idx}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [cm?.idx, cm?.items?.length])
  const history = useRef({
    stack: [value || ''],
    idx: 0,
    lastEmitted: value || '',
    applying: false,
    coalesceAt: 0
  })

  // Overlay highlight — memo on value + theme flag (cheap tokenizer).
  const darkUi = isDarkUi()
  const html = useMemo(() => highlightMermaidHtml(value || '', darkUi), [value, darkUi])

  // Sync history when parent changes value externally (file switch, etc.).
  useEffect(() => {
    const h = history.current
    const v = value || ''
    if (h.applying) {
      h.applying = false
      h.lastEmitted = v
      return
    }
    if (v === h.lastEmitted) return
    h.stack = [v]
    h.idx = 0
    h.lastEmitted = v
    h.coalesceAt = 0
  }, [value])

  useEffect(() => {
    const ta = taRef.current
    const pos = pendingCaret.current
    if (!ta || pos == null) return
    pendingCaret.current = null
    const clamped = Math.max(0, Math.min(pos, (value || '').length))
    try {
      ta.setSelectionRange(clamped, clamped)
    } catch {
      /* ok */
    }
  }, [value])

  const syncScroll = () => {
    const ta = taRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
    if (cmRef.current) setCm(null)
  }

  const pushHistory = (next, { coalesce = false } = {}) => {
    const h = history.current
    const now = Date.now()
    // Truncate redo branch
    if (h.idx < h.stack.length - 1) {
      h.stack = h.stack.slice(0, h.idx + 1)
    }
    const top = h.stack[h.stack.length - 1]
    if (top === next) {
      h.lastEmitted = next
      return
    }
    // Coalesce rapid typing into one undo step (~400ms idle window).
    if (coalesce && h.coalesceAt && now - h.coalesceAt < 400 && h.stack.length > 0) {
      h.stack[h.stack.length - 1] = next
    } else {
      h.stack.push(next)
      if (h.stack.length > 250) {
        h.stack.shift()
      } else {
        h.idx = h.stack.length - 1
      }
      h.idx = h.stack.length - 1
    }
    h.coalesceAt = coalesce ? now : 0
    h.lastEmitted = next
  }

  const emit = (next, caret, opts) => {
    pushHistory(next, opts)
    if (caret != null) pendingCaret.current = caret
    onChange?.({ target: { value: next } })
  }

  const applyHistoryTo = (idx) => {
    const h = history.current
    if (idx < 0 || idx >= h.stack.length) return
    h.idx = idx
    const next = h.stack[idx]
    h.applying = true
    h.lastEmitted = next
    h.coalesceAt = 0
    pendingCaret.current = next.length
    onChange?.({ target: { value: next } })
  }

  const undo = () => {
    const h = history.current
    if (h.idx <= 0) return
    applyHistoryTo(h.idx - 1)
  }

  const redo = () => {
    const h = history.current
    if (h.idx >= h.stack.length - 1) return
    applyHistoryTo(h.idx + 1)
  }

  const lineRange = (text, pos) => {
    const start = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
    const nl = text.indexOf('\n', pos)
    const end = nl === -1 ? text.length : nl + 1
    return { start, end }
  }

  const writeClip = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      /* fall through */
    }
    return false
  }

  const openCompletions = (text, pos, force) => {
    const ta = taRef.current
    const root = rootRef.current
    if (!ta || !root) return
    const { items, replaceStart, replaceEnd } = mermaidCompletions(text, pos, !!force)
    if (!items.length) {
      setCm(null)
      return
    }
    const prefix = text.slice(replaceStart, replaceEnd)
    if (!force && prefix.length < 1) {
      setCm(null)
      return
    }
    const off = caretClientOffset(ta, pos)
    const pad = 12
    const next = {
      items,
      idx: 0,
      start: replaceStart,
      end: replaceEnd,
      x: Math.max(4, Math.min(off.left + pad, root.clientWidth - 240)),
      y: Math.max(4, off.top + pad + 18)
    }
    cmRef.current = next
    setCm(next)
  }

  const acceptCompletion = (item) => {
    const cur = cmRef.current
    const ta = taRef.current
    if (!cur || !ta) return
    const text = value || ''
    const before = text.slice(0, cur.start)
    const after = text.slice(cur.end)
    const { text: insert, caretInInsert } = expandInsert(item.insert)
    const next = before + insert + after
    const caret = before.length + caretInInsert
    setCm(null)
    history.current.coalesceAt = 0
    emit(next, caret)
    requestAnimationFrame(() => ta.focus())
  }

  const onInputChange = (e) => {
    const next = e.target.value
    pushHistory(next, { coalesce: true })
    history.current.lastEmitted = next
    onChange?.(e)
    if (disabled) return
    const ta = e.target
    const pos = ta.selectionStart ?? next.length
    requestAnimationFrame(() => openCompletions(next, pos, false))
  }

  const onKeyDown = (e) => {
    if (disabled) return
    const ta = taRef.current
    if (!ta) return
    const text = value || ''
    const mod = e.metaKey || e.ctrlKey
    const popup = cmRef.current
    // Physical key — layout-independent (RU/EN/…).
    const code = e.code

    // --- completion popup navigation (↑↓ / Enter|Tab / Esc) ---
    if (popup && popup.items.length) {
      const isDown = code === 'ArrowDown' || e.key === 'ArrowDown'
      const isUp = code === 'ArrowUp' || e.key === 'ArrowUp'
      if (isDown || isUp) {
        e.preventDefault()
        e.stopPropagation()
        const n = popup.items.length
        const nextIdx = isDown ? (popup.idx + 1) % n : (popup.idx - 1 + n) % n
        const next = { ...popup, idx: nextIdx }
        // Update ref immediately so rapid key-repeat advances correctly
        // before React re-renders.
        cmRef.current = next
        setCm(next)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        acceptCompletion(popup.items[popup.idx] || popup.items[0])
        return
      }
      if (e.key === 'Escape' || code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cmRef.current = null
        setCm(null)
        return
      }
    }

    // Ctrl/Cmd+Space — open completions
    if (mod && !e.altKey && (code === 'Space' || e.key === ' ')) {
      e.preventDefault()
      e.stopPropagation()
      openCompletions(text, ta.selectionStart ?? 0, true)
      return
    }

    // Undo / Redo — must run before early-return; layout-independent via e.code
    if (mod && !e.altKey && code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      setCm(null)
      undo()
      return
    }
    if (mod && !e.altKey && ((code === 'KeyZ' && e.shiftKey) || code === 'KeyY')) {
      e.preventDefault()
      e.stopPropagation()
      setCm(null)
      redo()
      return
    }

    if (!mod || e.altKey) {
      if (popup && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
        setCm(null)
      }
      return
    }

    const selStart = ta.selectionStart ?? 0
    const selEnd = ta.selectionEnd ?? 0
    const hasSel = selStart !== selEnd

    // Cut
    if (code === 'KeyX' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      setCm(null)
      history.current.coalesceAt = 0
      if (hasSel) {
        void writeClip(text.slice(selStart, selEnd))
        emit(text.slice(0, selStart) + text.slice(selEnd), selStart)
        return
      }
      const { start, end } = lineRange(text, selStart)
      void writeClip(text.slice(start, end))
      emit(text.slice(0, start) + text.slice(end), Math.min(start, text.length - (end - start)))
      return
    }

    // Copy line
    if (code === 'KeyC' && !e.shiftKey) {
      if (hasSel) return
      e.preventDefault()
      e.stopPropagation()
      const { start, end } = lineRange(text, selStart)
      void writeClip(text.slice(start, end))
      return
    }

    // Delete line
    if (code === 'KeyK' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      setCm(null)
      history.current.coalesceAt = 0
      const from = hasSel ? Math.min(selStart, selEnd) : selStart
      const to = hasSel ? Math.max(selStart, selEnd) : selStart
      const start = lineRange(text, from).start
      const end = lineRange(text, Math.max(from, to - (to > from ? 1 : 0))).end
      emit(text.slice(0, start) + text.slice(end), Math.min(start, text.length - (end - start)))
      return
    }

    // Duplicate
    if (code === 'KeyD' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      setCm(null)
      history.current.coalesceAt = 0
      if (hasSel) {
        const selected = text.slice(selStart, selEnd)
        emit(text.slice(0, selEnd) + selected + text.slice(selEnd), selEnd + selected.length)
        requestAnimationFrame(() => {
          try {
            ta.setSelectionRange(selEnd, selEnd + selected.length)
          } catch {
            /* ok */
          }
        })
        return
      }
      const { start, end } = lineRange(text, selStart)
      const line = text.slice(start, end)
      emit(text.slice(0, end) + line + text.slice(end), selStart + line.length)
    }
  }

  const shared =
    'box-border absolute inset-0 m-0 resize-none overflow-auto whitespace-pre border-0 p-3 font-mono text-[12px] leading-5 outline-none'

  return jsxs('div', {
    ref: rootRef,
    className: 'relative min-h-0 flex-1',
    children: [
      jsx('pre', {
        ref: preRef,
        'aria-hidden': true,
        className: cn(shared, 'pointer-events-none z-0 bg-transparent', !value && 'opacity-0'),
        style: {
          fontFamily: EDITOR_FONT,
          color: isDarkUi() ? GH_DARK.fg : GH_LIGHT.fg,
          tabSize: 2
        },
        dangerouslySetInnerHTML: {
          __html: html || (value ? escHtml(value) : '&nbsp;')
        }
      }),
      !value
        ? jsx('div', {
            className:
              'pointer-events-none absolute inset-0 z-0 p-3 font-mono text-[12px] leading-5 text-(--ui-text-quaternary)',
            style: { fontFamily: EDITOR_FONT },
            children: placeholder || 'flowchart TD\n  A --> B'
          })
        : null,
      jsx('textarea', {
        ref: taRef,
        value: value,
        disabled: !!disabled,
        spellCheck: false,
        autoCapitalize: 'off',
        autoCorrect: 'off',
        autoComplete: 'off',
        placeholder: '',
        onChange: onInputChange,
        onPaste: (e) => {
          // Normalize + single history path (parent setSource around history was resetting stack).
          const clip = e.clipboardData?.getData('text')
          if (!clip) return
          e.preventDefault()
          e.stopPropagation()
          const ta = taRef.current
          const text = value || ''
          const start = ta?.selectionStart ?? text.length
          const end = ta?.selectionEnd ?? start
          const merged = text.slice(0, start) + clip + text.slice(end)
          const next = normalizeMermaidSource(merged)
          // Caret after inserted (normalized) region — not EOF-only.
          const inserted = next.length - (text.length - (end - start))
          const caret = Math.max(0, Math.min(start + Math.max(0, inserted), next.length))
          setCm(null)
          emit(next, caret, { coalesce: false })
        },
        onKeyDown,
        onScroll: syncScroll,
        onBlur: () => {
          setTimeout(() => setCm(null), 150)
        },
        className: cn(
          shared,
          'z-10 bg-transparent text-transparent',
          'selection:bg-(--ui-accent)/30',
          disabled && 'cursor-default opacity-60'
        ),
        style: {
          fontFamily: EDITOR_FONT,
          caretColor: 'var(--ui-text-primary)',
          tabSize: 2,
          WebkitTextFillColor: 'transparent'
        }
      }),
      cm && cm.items.length
        ? jsx('div', {
            ref: listRef,
            role: 'listbox',
            'aria-activedescendant': `mm-cm-${cm.idx}`,
            'aria-label': 'Completions',
            className:
              'absolute z-30 max-h-56 min-w-52 max-w-80 overflow-auto rounded-[6px] border border-(--ui-stroke-secondary)/50 bg-(--ui-bg-primary) py-1 text-xs shadow-lg',
            style: { left: cm.x, top: cm.y },
            onMouseDown: (e) => e.preventDefault(),
            children: cm.items.map((item, i) => {
              const selected = i === cm.idx
              return jsxs(
                'div',
                {
                  id: `mm-cm-${i}`,
                  role: 'option',
                  'data-cm-idx': String(i),
                  'aria-selected': selected,
                  className: cn(
                    'flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left normal-case',
                    selected
                      ? 'text-foreground'
                      : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
                  ),
                  style: selected
                    ? {
                        background:
                          'color-mix(in oklab, var(--ui-accent) 32%, var(--ui-bg-tertiary, transparent))',
                        boxShadow: 'inset 2px 0 0 var(--ui-accent)'
                      }
                    : undefined,
                  onMouseEnter: () => {
                    const cur = cmRef.current
                    if (!cur || cur.idx === i) return
                    const next = { ...cur, idx: i }
                    cmRef.current = next
                    setCm(next)
                  },
                  onMouseDown: (e) => {
                    e.preventDefault()
                    acceptCompletion(item)
                  },
                  children: [
                    jsx('span', {
                      className: cn(
                        'w-12 shrink-0 text-[0.65rem] uppercase tracking-wide',
                        selected ? 'text-(--ui-accent)' : 'text-(--ui-text-quaternary)'
                      ),
                      children: item.kind || ''
                    }),
                    jsx('span', {
                      className: cn(
                        'min-w-0 flex-1 truncate font-mono text-[0.75rem]',
                        selected ? 'font-medium text-foreground' : 'text-foreground'
                      ),
                      children: item.label
                    }),
                    item.detail
                      ? jsx('span', {
                          className: 'max-w-[40%] shrink-0 truncate text-[0.65rem] text-(--ui-text-quaternary)',
                          children: item.detail
                        })
                      : null
                  ]
                },
                item.kind + ':' + item.label + ':' + i
              )
            })
          })
        : null,
      jsx('div', {
        className:
          'pointer-events-none absolute bottom-1 right-2 z-20 text-[0.65rem] text-(--ui-text-quaternary)/80',
        children: '↑↓ · Tab · Ctrl+Space'
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Theme + remote SVG render
// ---------------------------------------------------------------------------

function isDarkUi() {
  try {
    const bg =
      getComputedStyle(document.body).backgroundColor ||
      getComputedStyle(document.documentElement).backgroundColor ||
      ''
    const m = String(bg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return true
    const r = Number(m[1])
    const g = Number(m[2])
    const b = Number(m[3])
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
  } catch {
    return true
  }
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function withThemeDirective(code, dark) {
  const trimmed = code.trim()
  if (!trimmed) return ''
  if (/%%\s*\{\s*init\s*:/i.test(trimmed) || /theme\s*:/i.test(trimmed.slice(0, 200))) {
    return trimmed
  }
  if (!dark) return trimmed
  return `%%{init: {'theme':'dark'}}%%\n${trimmed}`
}

async function renderRemoteSvg(code, dark, signal) {
  const themed = withThemeDirective(normalizeMermaidSource(code), dark)
  if (!themed) return { kind: 'empty' }

  const encoded = utf8ToBase64(themed)
  if (encoded.length < 6000) {
    try {
      const res = await fetch(`https://mermaid.ink/svg/${encoded}`, { signal, mode: 'cors' })
      if (res.ok) {
        const svg = await res.text()
        if (svg.includes('<svg')) return { kind: 'ok', svg, via: 'mermaid.ink' }
      }
    } catch (err) {
      if (signal?.aborted) throw err
    }
  }

  const res = await fetch('https://kroki.io/mermaid/svg', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: themed,
    signal,
    mode: 'cors'
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400)
    throw new Error(`render failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const svg = await res.text()
  if (!svg.includes('<svg')) throw new Error('render returned non-SVG body')
  return { kind: 'ok', svg, via: 'kroki' }
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

/** DOMParser sanitize for remote SVG (dangerouslySetInnerHTML).
 * Keep foreignObject — mermaid htmlLabels live there; scrub kids only. */
function sanitizeSvg(raw) {
  const input = String(raw || '')
  if (!input.trim()) return ''
  try {
    const doc = new DOMParser().parseFromString(input, 'image/svg+xml')
    const parseErr = doc.querySelector('parsererror')
    if (parseErr) return ''
    const root = doc.documentElement
    if (!root || String(root.tagName).toLowerCase() !== 'svg') return ''

    // Kill active content; keep foreignObject (mermaid labels = HTML inside FO).
    const DENY = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select'])

    const scrubAttrs = (node) => {
      if (!node?.attributes) return
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name
        const lname = name.toLowerCase()
        if (lname.startsWith('on') || lname === 'srcdoc') {
          node.removeAttribute(name)
          continue
        }
        if (
          lname === 'href' ||
          lname === 'xlink:href' ||
          lname === 'src' ||
          lname === 'action' ||
          lname === 'formaction' ||
          lname.endsWith(':href')
        ) {
          const v = String(attr.value || '').trim()
          const low = v.toLowerCase()
          // No scheme-relative //host — startsWith('/') alone would allow it.
          const ok =
            !v ||
            low.startsWith('#') ||
            (low.startsWith('/') && !low.startsWith('//')) ||
            low.startsWith('./') ||
            low.startsWith('../') ||
            low.startsWith('http://') ||
            low.startsWith('https://')
          if (!ok) node.removeAttribute(name)
        }
        // style: drop expression()/url(javascript:...)
        if (lname === 'style') {
          const st = String(attr.value || '')
          if (/expression\s*\(|javascript:|@import/i.test(st)) node.removeAttribute(name)
        }
      }
    }

    const walk = (el) => {
      // childNodes: FO may hold text + HTML elements
      const kids = Array.from(el.childNodes || [])
      for (const child of kids) {
        if (child.nodeType === 1 /* ELEMENT */) {
          const tag = String(child.tagName || '').toLowerCase().replace(/^.*:/, '')
          if (DENY.has(tag)) {
            child.remove()
            continue
          }
          scrubAttrs(child)
          walk(child)
        }
      }
    }
    scrubAttrs(root)
    walk(root)
    // mermaid width/height 100% breaks pan/zoom framing
    if (root.getAttribute('width') === '100%') root.removeAttribute('width')
    if (root.getAttribute('height') === '100%') root.removeAttribute('height')
    const st = root.getAttribute('style')
    if (st && /max-width/i.test(st)) {
      root.setAttribute(
        'style',
        st
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p && !/^max-width\s*:/i.test(p))
          .join('; ')
      )
    }
    return new XMLSerializer().serializeToString(root)
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------

function ToolbarButton(props) {
  const { tip, onClick, children, variant, disabled } = props
  const btn = jsx(Button, {
    type: 'button',
    size: 'xs',
    variant: variant || 'ghost',
    disabled: !!disabled,
    onClick: () => {
      haptic('tap')
      onClick?.()
    },
    children
  })
  if (!tip) return btn
  return jsx(Tip, { label: tip, children: btn })
}

function CornerSpinner({ show, label }) {
  if (!show) return null
  return jsx(Tip, {
    label: label || 'Loading…',
    children: jsx('div', {
      className:
        'pointer-events-none absolute right-2 bottom-2 z-20 flex items-center gap-1.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary) shadow-sm backdrop-blur-sm',
      children: jsxs('span', {
        className: 'inline-flex items-center gap-1.5',
        children: [jsx(GlyphSpinner, { className: 'text-(--ui-text-secondary)' }), label || '…']
      })
    })
  })
}

const SPLIT_MIN = 18
const SPLIT_MAX = 82

/**
 * Vertical sash matching Hermes pane-shell (`tree-split.tsx` Sash):
 * 9px hit target, hairline at opacity-10 → full on hover, thicker
 * `--ui-sash-hover-border` band on hover. No grip dots.
 */
function SplitSash({ onLivePct, onCommitPct, onReset }) {
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const lastPctRef = useRef(null)

  const measurePct = (e) => {
    // Parent is the split row (source | sash | preview).
    const row = e.currentTarget.parentElement?.parentElement
    if (!row) return null
    const rect = row.getBoundingClientRect()
    if (!(rect.width > 0)) return null
    return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((e.clientX - rect.left) / rect.width) * 100))
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onPointerMove = (e) => {
    if (!draggingRef.current) return
    const pct = measurePct(e)
    if (pct == null) return
    lastPctRef.current = pct
    onLivePct?.(pct)
  }

  const endDrag = (e) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    const pct = lastPctRef.current ?? measurePct(e)
    lastPctRef.current = null
    if (pct != null) onCommitPct?.(pct)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
  }

  return jsx('div', {
    className: 'relative z-20 w-0 shrink-0 self-stretch',
    children: jsxs('div', {
      role: 'separator',
      'aria-orientation': 'vertical',
      'data-slot': 'pane-resize-handle',
      title: 'Drag to resize · double-click to reset',
      className: cn(
        'group/sash absolute inset-y-0 left-0 z-20 w-[9px] -translate-x-1/2 cursor-col-resize',
        '[-webkit-app-region:no-drag]'
      ),
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: (e) => {
        e.preventDefault()
        onReset?.()
      },
      children: [
        // Persistent hairline — same token as pane-shell seams.
        jsx('span', {
          className: cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
            'bg-(--ui-stroke-secondary) transition-opacity duration-100',
            dragging ? 'opacity-100' : 'opacity-10 group-hover/sash:opacity-100'
          )
        }),
        // Hover / active grab band (vscode-sash-hover-size, default 4px).
        jsx('span', {
          className: cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-(--vscode-sash-hover-size,0.25rem) -translate-x-1/2',
            'bg-(--ui-sash-hover-border) transition-opacity duration-100',
            dragging ? 'opacity-100' : 'opacity-0 group-hover/sash:opacity-100'
          )
        })
      ]
    })
  })
}

function SvgCanvas({ svg, fitKey }) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const dragRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [grabbing, setGrabbing] = useState(false)
  const lastFitKey = useRef(null)
  const fittedForKey = useRef(null)
  const chromePctAt = useRef(0)
  const chromeActionsRef = useRef({
    zoomIn: () => {},
    zoomOut: () => {},
    reset: () => {},
    fit: () => {}
  })
  const safeSvg = useMemo(() => sanitizeSvg(svg), [svg])

  const paintDom = useCallback((v) => {
    const el = contentRef.current
    if (!el) return
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`
    el.style.transformOrigin = '0 0'
  }, [])

  // Parent re-renders (source/svg) must not wipe mid-gesture DOM transform.
  useEffect(() => {
    paintDom(viewRef.current)
  })

  const pushChrome = useCallback((pct) => {
    const a = chromeActionsRef.current
    $previewChrome.set({
      pct,
      zoomIn: a.zoomIn,
      zoomOut: a.zoomOut,
      reset: a.reset,
      fit: a.fit
    })
  }, [])

  // Commit React state (gesture end / Fit / reset). Mid-gesture uses paintDom only.
  const commitView = useCallback(
    (next) => {
      const v = { scale: clampZoom(next.scale), tx: next.tx, ty: next.ty }
      viewRef.current = v
      paintDom(v)
      setScale(v.scale)
      setTx(v.tx)
      setTy(v.ty)
      chromePctAt.current = Date.now()
      pushChrome(Math.round(v.scale * 100))
    },
    [paintDom, pushChrome]
  )

  // Imperative mid-gesture: DOM + optional throttled chrome pct.
  const liveView = useCallback(
    (next) => {
      const v = { scale: clampZoom(next.scale), tx: next.tx, ty: next.ty }
      viewRef.current = v
      paintDom(v)
      const now = Date.now()
      // ponytail: throttle 100ms chrome; rAF batch if still janky
      if (now - chromePctAt.current >= 100) {
        chromePctAt.current = now
        pushChrome(Math.round(v.scale * 100))
      }
    },
    [paintDom, pushChrome]
  )

  const resetView = useCallback(() => commitView({ scale: 1, tx: 0, ty: 0 }), [commitView])

  const fitView = useCallback(() => {
    const vp = viewportRef.current
    const content = contentRef.current
    if (!vp || !content) return
    const svgEl = content.querySelector('svg')
    if (!svgEl) return
    let w = 0
    let h = 0
    let ox = 0
    let oy = 0
    try {
      const box = svgEl.getBBox()
      w = box.width
      h = box.height
      ox = box.x
      oy = box.y
    } catch {
      w = svgEl.clientWidth || 0
      h = svgEl.clientHeight || 0
    }
    if (!(w > 0 && h > 0)) return
    const pad = 32
    const nextScale = clampZoom(Math.min((vp.clientWidth - pad * 2) / w, (vp.clientHeight - pad * 2) / h, 2.5))
    commitView({
      scale: nextScale,
      tx: (vp.clientWidth - w * nextScale) / 2 - ox * nextScale,
      ty: (vp.clientHeight - h * nextScale) / 2 - oy * nextScale
    })
  }, [commitView])

  const normalizeSvgEl = useCallback(() => {
    const svgEl = contentRef.current?.querySelector('svg')
    if (!svgEl) return
    svgEl.style.maxWidth = 'none'
    svgEl.style.width = 'auto'
    svgEl.style.height = 'auto'
    svgEl.removeAttribute('width')
    if (svgEl.getAttribute('height') === '100%') svgEl.removeAttribute('height')
  }, [])

  const zoomBy = useCallback(
    (factor) => {
      const el = viewportRef.current
      const cur = viewRef.current
      const rect = el?.getBoundingClientRect()
      const mx = rect ? rect.width / 2 : 0
      const my = rect ? rect.height / 2 : 0
      const nextScale = clampZoom(cur.scale * factor)
      const k = nextScale / cur.scale
      commitView({ scale: nextScale, tx: mx - k * (mx - cur.tx), ty: my - k * (my - cur.ty) })
    },
    [commitView]
  )

  // File switch → allow one auto-fit for the next successful SVG.
  useEffect(() => {
    const key = fitKey ?? ''
    if (lastFitKey.current === key) return
    lastFitKey.current = key
    fittedForKey.current = null
    resetView()
  }, [fitKey, resetView])

  // Source edits re-render SVG — keep pan/zoom. Only normalize attributes.
  // Auto-fit once per fitKey when SVG first becomes available.
  useEffect(() => {
    if (!svg) return
    const key = fitKey ?? ''
    const t = requestAnimationFrame(() => {
      normalizeSvgEl()
      paintDom(viewRef.current)
      if (fittedForKey.current !== key) {
        fittedForKey.current = key
        requestAnimationFrame(() => fitView())
      }
    })
    return () => cancelAnimationFrame(t)
  }, [svg, fitKey, normalizeSvgEl, fitView, paintDom])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const cur = viewRef.current
      if (e.shiftKey || e.altKey) {
        liveView({
          scale: cur.scale,
          tx: cur.tx + (e.shiftKey ? -e.deltaY : -e.deltaX),
          ty: cur.ty + (e.shiftKey ? 0 : -e.deltaY)
        })
        return
      }
      const direction = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      const factor = e.ctrlKey || e.metaKey ? Math.pow(direction, 0.55) : direction
      const nextScale = clampZoom(cur.scale * factor)
      const k = nextScale / cur.scale
      liveView({ scale: nextScale, tx: mx - k * (mx - cur.tx), ty: my - k * (my - cur.ty) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [liveView])

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const cur = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty }
    setGrabbing(true)
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    liveView({
      scale: viewRef.current.scale,
      tx: d.tx + (e.clientX - d.x),
      ty: d.ty + (e.clientY - d.y)
    })
  }
  const endDrag = (e) => {
    if (!dragRef.current) return
    dragRef.current = null
    setGrabbing(false)
    // one React commit after pan
    commitView(viewRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
  }

  // Wire chrome actions (stable via ref); pct from live/commit.
  useEffect(() => {
    chromeActionsRef.current = {
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      reset: () => resetView(),
      fit: () => fitView()
    }
    pushChrome(Math.round(viewRef.current.scale * 100))
    return () => {
      $previewChrome.set(null)
    }
  }, [zoomBy, resetView, fitView, pushChrome])

  return jsx('div', {
    className: 'relative flex min-h-0 flex-1 flex-col',
    children: jsx('div', {
      ref: viewportRef,
      className: cn(
        'relative min-h-0 flex-1 overflow-hidden touch-none',
        grabbing ? 'cursor-grabbing' : 'cursor-grab'
      ),
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: (e) => {
        e.preventDefault()
        fitView()
      },
      children: jsx('div', {
        ref: contentRef,
        className: 'origin-top-left will-change-transform select-none',
        style: {
          transformOrigin: '0 0'
        },
        dangerouslySetInnerHTML: { __html: safeSvg }
      })
    })
  })
}

/** Shared pane header — same height/padding for SOURCE and PREVIEW. */
function PaneHeader({ title, right }) {
  return jsxs('div', {
    className:
      'flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--ui-stroke-secondary)/30 px-3 text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
    children: [
      jsx('span', { className: 'leading-none', children: title }),
      jsx('div', {
        className: 'flex h-7 items-center justify-end',
        children: right || null
      })
    ]
  })
}

/** Zoom controls for the PREVIEW header row. */
function PreviewChrome() {
  const chrome = useValue($previewChrome)
  if (!chrome) {
    // Keep header height stable while canvas mounts.
    return jsx('div', { className: 'h-7 w-[7.5rem]' })
  }
  return jsxs('div', {
    className:
      'flex h-7 items-center gap-0.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-1 shadow-sm backdrop-blur-sm',
    children: [
      jsx(ToolbarButton, {
        tip: 'Zoom out',
        onClick: () => chrome.zoomOut(),
        children: jsx(Codicon, { name: 'zoom-out' })
      }),
      jsx('button', {
        type: 'button',
        className:
          'w-12 shrink-0 rounded-[3px] px-0 py-0.5 text-center text-[0.6875rem] tabular-nums normal-case text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        title: 'Reset to 100%',
        onClick: () => {
          haptic('tap')
          chrome.reset()
        },
        children: `${chrome.pct}%`
      }),
      jsx(ToolbarButton, {
        tip: 'Zoom in',
        onClick: () => chrome.zoomIn(),
        children: jsx(Codicon, { name: 'zoom-in' })
      }),
      jsx(ToolbarButton, {
        tip: 'Fit',
        onClick: () => chrome.fit(),
        children: jsx(Codicon, { name: 'screen-full' })
      })
    ]
  })
}

/** Status chip for SOURCE header — mirrors PreviewChrome footprint. */
function SourceChrome({ dirty, onSave, disabled }) {
  return jsxs('div', {
    className:
      'flex h-7 items-center gap-0.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-1 shadow-sm backdrop-blur-sm',
    children: [
      jsx('span', {
        className: cn(
          'min-w-12 px-1.5 text-center text-[0.6875rem] tabular-nums normal-case',
          dirty ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'
        ),
        children: dirty ? 'dirty' : 'saved'
      }),
      jsx(ToolbarButton, {
        tip: dirty ? 'Save now' : 'Saved',
        disabled: disabled || !dirty,
        onClick: onSave,
        children: jsx(Codicon, { name: 'save' })
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function FlowPage() {
  const cwd = useValue(host.state.cwd)

  const projectKey = cwd || '__none__'

  const [relDir, setRelDir] = useState(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {}
    return map[projectKey] || DEFAULT_REL_DIR
  })
  const diagramsDir = useMemo(() => resolveDiagramsDir(cwd, relDir), [cwd, relDir])

  const [files, setFiles] = useState([])
  const [activePath, setActivePath] = useState('')
  const [source, setSource] = useState('')
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState(() => storage?.get(STORAGE_VIEW, 'split') || 'split')
  const [splitPct, setSplitPct] = useState(() => {
    const n = Number(storage?.get(STORAGE_SPLIT, 50))
    return Number.isFinite(n) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n)) : 50
  })
  const [svg, setSvg] = useState('')
  const [via, setVia] = useState('')
  const [renderError, setRenderError] = useState('')
  const [fsError, setFsError] = useState('')
  const [busy, setBusy] = useState('') // '' | list | file | render | save | create
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderDraft, setFolderDraft] = useState(relDir)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  const genRef = useRef(0)
  const saveTimer = useRef(null)
  const saveGenRef = useRef(0)
  const activePathRef = useRef('')
  const sourceRef = useRef('')
  const dirtyRef = useRef(false)
  const leftPaneRef = useRef(null)
  const sashDraggingRef = useRef(false)

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])
  useEffect(() => {
    sourceRef.current = source
  }, [source])
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Split width via DOM only — React style.width would wipe live sash drag on re-render.
  useEffect(() => {
    const el = leftPaneRef.current
    if (!el) return
    if (view === 'split') {
      if (!sashDraggingRef.current) el.style.width = `${splitPct}%`
      el.style.maxWidth = '100%'
    } else {
      el.style.width = ''
      el.style.maxWidth = ''
    }
  }, [view, splitPct])

  useEffect(() => {
    storage?.set(STORAGE_VIEW, view)
  }, [view])

  useEffect(() => {
    storage?.set(STORAGE_SPLIT, splitPct)
  }, [splitPct])

  // Persist per-project folder + active file (copy-on-write maps)
  useEffect(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {}
    storage?.set(STORAGE_DIRS, { ...map, [projectKey]: relDir })
  }, [projectKey, relDir])

  useEffect(() => {
    if (!activePath) return
    const map = storage?.get(STORAGE_ACTIVE, {}) || {}
    storage?.set(STORAGE_ACTIVE, { ...map, [projectKey]: baseName(activePath) })
  }, [projectKey, activePath])

  // When cwd changes, reload folder config
  useEffect(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {}
    setRelDir(map[projectKey] || DEFAULT_REL_DIR)
  }, [projectKey])

  const writeActiveIfDirty = useCallback(async () => {
    const path = activePathRef.current
    const body = sourceRef.current
    if (!path || !dirtyRef.current) return false
    const packed = packSource(body, baseName(path))
    try {
      await fsWriteText(path, packed)
    } catch (err) {
      const msg = err?.message || String(err)
      if (/parent directory does not exist|ENOENT|not exist/i.test(msg)) {
        const dir = path.replace(/[/\\][^/\\]+$/, '')
        await fsEnsureDir(dir, { open: false })
        await fsWriteText(path, packed)
      } else {
        throw err
      }
    }
    return true
  }, [])

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const path = activePathRef.current
    const body = sourceRef.current
    if (!path || !dirtyRef.current) return
    const gen = ++saveGenRef.current
    setBusy((b) => b || 'save')
    try {
      await writeActiveIfDirty()
      if (gen !== saveGenRef.current) return
      if (activePathRef.current !== path || sourceRef.current !== body) return
      setDirty(false)
      dirtyRef.current = false
    } catch (err) {
      if (gen === saveGenRef.current) {
        host.notify({ kind: 'error', message: err?.message || 'Save failed' })
      }
    } finally {
      if (gen === saveGenRef.current) setBusy((b) => (b === 'save' ? '' : b))
    }
  }, [writeActiveIfDirty])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushSave()
    }, 550)
  }, [flushSave])

  // Unmount / route leave: flush dirty without setState-after-unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      // Invalidate in-flight flushSave so it won't setState after unmount.
      saveGenRef.current++
      if (!dirtyRef.current || !activePathRef.current) return
      const path = activePathRef.current
      const body = sourceRef.current
      const packed = packSource(body, baseName(path))
      void (async () => {
        try {
          await fsWriteText(path, packed)
          dirtyRef.current = false
        } catch (err) {
          try {
            const msg = err?.message || String(err)
            if (/parent directory does not exist|ENOENT|not exist/i.test(msg)) {
              const dir = path.replace(/[/\\][^/\\]+$/, '')
              await fsEnsureDir(dir, { open: false })
              await fsWriteText(path, packed)
              dirtyRef.current = false
              return
            }
          } catch {
            /* fall through */
          }
          try {
            host.notify({ kind: 'error', message: err?.message || 'Save failed' })
          } catch {
            /* unmounting */
          }
        }
      })()
    }
  }, [])

  const loadFile = useCallback(async (path) => {
    if (!path) return
    // save previous first
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (dirtyRef.current && activePathRef.current && activePathRef.current !== path) {
      try {
        await fsWriteText(
          activePathRef.current,
          packSource(sourceRef.current, baseName(activePathRef.current))
        )
        setDirty(false)
        dirtyRef.current = false
      } catch {
        /* keep going */
      }
    }

    setBusy('file')
    setFsError('')
    try {
      const text = await fsReadText(path)
      const src = extractSource(text, baseName(path))
      setActivePath(path)
      setSource(src)
      setDirty(false)
      dirtyRef.current = false
    } catch (err) {
      setFsError(err?.message || String(err))
      host.notify({ kind: 'error', message: err?.message || 'Read failed' })
    } finally {
      setBusy((b) => (b === 'file' ? '' : b))
    }
  }, [])

  const refreshList = useCallback(
    async ({ preferName, autoSelect = true } = {}) => {
      if (!cwd) {
        setFiles([])
        setFsError('No project cwd — open a project first')
        return
      }
      setBusy('list')
      setFsError('')
      try {
        const list = await listDiagramFiles(diagramsDir)
        setFiles(list)

        if (!autoSelect) return

        const remembered = (storage?.get(STORAGE_ACTIVE, {}) || {})[projectKey]
        const pick =
          (preferName && list.find((f) => f.name === preferName || f.label === preferName)) ||
          list.find((f) => f.name === remembered) ||
          list.find((f) => f.path === activePathRef.current) ||
          list[0]

        if (pick) {
          if (pick.path !== activePathRef.current) await loadFile(pick.path)
        } else {
          setActivePath('')
          setSource('')
          setSvg('')
          setDirty(false)
        }
      } catch (err) {
        setFiles([])
        setFsError(err?.message || String(err))
      } finally {
        setBusy((b) => (b === 'list' ? '' : b))
      }
    },
    [cwd, diagramsDir, projectKey, loadFile]
  )

  // Load list when dir / cwd changes
  useEffect(() => {
    void refreshList()
  }, [refreshList])

  // Render preview
  const debounced = useDebounced(source, 320)
  useEffect(() => {
    const code = debounced.trim()
    if (!code) {
      setSvg('')
      setVia('')
      setRenderError('')
      return
    }
    const gen = ++genRef.current
    const ac = new AbortController()
    setBusy((b) => (b === 'file' || b === 'list' ? b : 'render'))
    setRenderError('')
    renderRemoteSvg(code, isDarkUi(), ac.signal)
      .then((result) => {
        if (gen !== genRef.current) return
        if (result.kind === 'empty') {
          setSvg('')
          setVia('')
          return
        }
        setSvg(result.svg)
        setVia(result.via || '')
      })
      .catch((err) => {
        if (ac.signal.aborted || gen !== genRef.current) return
        setRenderError(err?.message || String(err))
      })
      .finally(() => {
        if (gen === genRef.current) setBusy((b) => (b === 'render' ? '' : b))
      })
    return () => ac.abort()
  }, [debounced])

  const onSourceChange = (e) => {
    setSource(e.target.value)
    setDirty(true)
    dirtyRef.current = true
    if (activePath) scheduleSave()
  }

  const createDiagram = async () => {
    const fileName = ensureMmdName(newName)
    if (!cwd) {
      host.notify({ kind: 'error', message: 'No project cwd' })
      return
    }
    setBusy('create')
    try {
      await fsEnsureDir(diagramsDir, { open: false })
      const path = joinPath(diagramsDir, fileName)
      try {
        await fsReadText(path)
        host.notify({ kind: 'error', message: `${fileName} already exists` })
        return
      } catch {
        /* new file ok */
      }
      await fsWriteText(path, DEFAULT_SOURCE)
      setNewOpen(false)
      setNewName('')
      await refreshList({ preferName: fileName })
      host.notify({ kind: 'success', message: `Created ${fileName}` })
    } catch (err) {
      host.notify({ kind: 'error', message: err?.message || 'Create failed' })
    } finally {
      setBusy((b) => (b === 'create' ? '' : b))
    }
  }

  const applyFolder = async () => {
    const next = folderDraft.trim() || DEFAULT_REL_DIR
    setRelDir(next)
    setFolderOpen(false)
    host.notify({ kind: 'info', message: `Diagrams folder: ${next}` })
  }

  const browseFolder = async () => {
    const b = bridge()
    if (!b?.selectPaths) {
      host.notify({ kind: 'error', message: 'Folder picker unavailable' })
      return
    }
    const picked = await b.selectPaths({
      title: 'Mermaid diagrams folder',
      defaultPath: diagramsDir,
      directories: true,
      multiple: false
    })
    const path = picked?.[0]
    if (!path) return
    // Prefer project-relative when under cwd
    if (cwd && String(path).startsWith(cwd)) {
      const rel = String(path)
        .slice(cwd.length)
        .replace(/^[/\\]+/, '')
      setFolderDraft(rel || '.')
    } else {
      setFolderDraft(path)
    }
  }

  const revealFolder = async () => {
    try {
      await fsEnsureDir(diagramsDir, { open: true })
    } catch (err) {
      host.notify({ kind: 'error', message: err?.message || 'Reveal failed' })
    }
  }

  const copySource = async () => {
    const ok = os ? await os.writeClipboard(source) : false
    host.notify({ kind: ok ? 'success' : 'error', message: ok ? 'Source copied' : 'Clipboard unavailable' })
  }

  const copySvg = async () => {
    if (!svg) return
    const ok = os ? await os.writeClipboard(svg) : false
    host.notify({ kind: ok ? 'success' : 'error', message: ok ? 'SVG copied' : 'Clipboard unavailable' })
  }

  /** Open a path dropped from the files tree (or OS). Mermaid-like only. */
  const openExternalPath = useCallback(
    async (path) => {
      if (!path) return
      if (!isMermaidPath(path)) {
        host.notify({
          kind: 'error',
          message: 'Drop a .mmd / .mermaid / .md file'
        })
        return
      }

      const name = baseName(path)
      const label = name.replace(/\.(mmd|mermaid|md)$/i, '')
      setFiles((prev) => {
        if (prev.some((f) => f.path === path)) return prev
        return [...prev, { name, path, label }].sort((a, b) => a.label.localeCompare(b.label))
      })
      await loadFile(path)
      host.notify({ kind: 'success', message: `Opened ${name}` })
    },
    [loadFile]
  )

  const onDragEnter = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setDragOver(true)
  }

  const onDragLeave = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer) && !dragOver) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  const onDragOver = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = 'copy'
    } catch {
      /* ok */
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    const paths = pathsFromDataTransfer(e.dataTransfer)
    const file = paths.find((p) => isMermaidPath(p)) || paths[0]
    if (!file) {
      host.notify({ kind: 'error', message: 'No file path in drop' })
      return
    }
    void openExternalPath(file)
  }

  const statusBadge = useMemo(() => {
    if (busy === 'save') return jsx(Badge, { variant: 'muted', children: 'saving' })
    if (dirty) return jsx(Badge, { variant: 'warn', children: 'dirty' })
    if (renderError) return jsx(Badge, { variant: 'destructive', children: 'error' })
    if (via) return jsx(Badge, { variant: 'default', children: via })
    return jsx(Badge, { variant: 'outline', children: 'idle' })
  }, [busy, dirty, renderError, via])

  const showEditor = view === 'split' || view === 'source'
  const showPreview = view === 'split' || view === 'preview'
  const activeFile = files.find((f) => f.path === activePath)
  const spinnerShow = busy === 'list' || busy === 'file' || busy === 'render' || busy === 'create'
  const spinnerLabel =
    busy === 'list'
      ? 'Listing…'
      : busy === 'file'
        ? 'Loading…'
        : busy === 'create'
          ? 'Creating…'
          : busy === 'render'
            ? 'Rendering…'
            : ''

  return jsxs('div', {
    className: 'relative flex h-full min-h-0 flex-col',
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    children: [
      dragOver
        ? jsx('div', {
            className:
              'pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-(--ui-accent)/10 ring-2 ring-inset ring-(--ui-accent)/50',
            children: jsxs('div', {
              className:
                'rounded-[8px] border border-(--ui-accent)/40 bg-(--ui-bg-tertiary)/95 px-4 py-3 text-sm text-foreground shadow-md backdrop-blur-sm',
              children: [
                jsxs('div', {
                  className: 'flex items-center gap-2 font-medium',
                  children: [jsx(Codicon, { name: 'file-symlink-file' }), 'Drop to open diagram']
                }),
                jsx('div', {
                  className: 'mt-1 text-[0.75rem] text-(--ui-text-tertiary)',
                  children: '.mmd · .mermaid · .md'
                })
              ]
            })
          })
        : null,

      // toolbar
      jsxs('div', {
        className:
          'flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-secondary)/40 px-3 py-2',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2 min-w-0',
            children: [
              jsx(Codicon, { name: 'type-hierarchy-sub', className: 'text-(--ui-text-tertiary)' }),
              jsx('div', { className: 'text-sm font-medium shrink-0', children: 'Mermaid Flow' }),
              statusBadge
            ]
          }),

          // diagram selector + create
          jsxs('div', {
            className: 'flex items-center gap-1 min-w-0',
            children: [
              jsxs(Select, {
                value: activePath || undefined,
                onValueChange: (v) => void loadFile(v),
                disabled: !files.length,
                children: [
                  jsx(SelectTrigger, {
                    size: 'xs',
                    className: 'min-w-40 max-w-56',
                    children: jsx(SelectValue, {
                      placeholder: files.length ? 'Select diagram' : 'No diagrams'
                    })
                  }),
                  jsx(SelectContent, {
                    children: files.map((f) =>
                      jsx(SelectItem, { value: f.path, children: f.label }, f.path)
                    )
                  })
                ]
              }),
              jsx(ToolbarButton, {
                tip: 'New diagram',
                variant: 'secondary',
                onClick: () => {
                  setNewName('')
                  setNewOpen(true)
                },
                children: jsx(Codicon, { name: 'add' })
              }),
              jsx(ToolbarButton, {
                tip: 'Reload folder',
                onClick: () => void refreshList(),
                children: jsx(Codicon, { name: 'refresh' })
              }),
              jsx(ToolbarButton, {
                tip: `Folder: ${relDir}`,
                onClick: () => {
                  setFolderDraft(relDir)
                  setFolderOpen(true)
                },
                children: jsx(Codicon, { name: 'folder' })
              })
            ]
          }),

          jsx('div', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary) truncate max-w-[28%]',
            children: activeFile ? activeFile.name : relDir
          }),

          jsx('div', { className: 'flex-1' }),

          jsx(SegmentedControl, {
            value: view,
            onChange: (v) => setView(v),
            options: [
              { id: 'split', label: 'Split' },
              { id: 'source', label: 'Source' },
              { id: 'preview', label: 'Preview' }
            ]
          }),

          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsx(ToolbarButton, {
                tip: 'Save now',
                disabled: !dirty || !activePath,
                onClick: () => void flushSave(),
                children: jsx(Codicon, { name: 'save' })
              }),
              jsx(ToolbarButton, {
                tip: 'Copy source',
                onClick: copySource,
                children: jsx(Codicon, { name: 'copy' })
              }),
              jsx(ToolbarButton, {
                tip: 'Copy SVG',
                disabled: !svg,
                onClick: copySvg,
                children: 'SVG'
              })
            ]
          })
        ]
      }),

      // body
      !cwd
        ? jsx('div', {
            className: 'flex flex-1 items-center justify-center p-6',
            children: jsx(EmptyState, {
              title: 'No project open',
              description: 'Open a project so diagrams can live under docs/mermaid.'
            })
          })
        : jsxs('div', {
            className: cn('relative flex min-h-0 flex-1', view === 'split' ? 'flex-row' : 'flex-col'),
            children: [
              showEditor
                ? jsxs('div', {
                    ref: leftPaneRef,
                    className: cn(
                      'flex min-h-0 min-w-0 flex-col',
                      view === 'split' ? 'shrink-0' : 'flex-1'
                    ),
                    // width via effect + sash refs (not React style — mid-drag re-render wipe)
                    children: [
                      jsx(PaneHeader, {
                        title: 'source',
                        right: jsx(SourceChrome, {
                          dirty,
                          disabled: !activePath,
                          onSave: () => void flushSave()
                        })
                      }),
                      !activePath && !files.length
                        ? jsx('div', {
                            className: 'flex flex-1 items-center justify-center p-6',
                            children: jsx(EmptyState, {
                              title: fsError ? 'Folder unavailable' : 'No diagrams yet',
                              description: fsError
                                ? `${fsError} — create the folder or pick another path.`
                                : `Create one with +  ·  ${relDir}`
                            })
                          })
                        : jsx(MermaidEditor, {
                            value: source,
                            onChange: onSourceChange,
                            disabled: !activePath,
                            placeholder: 'flowchart TD\n  A --> B'
                          }),
                      renderError
                        ? jsx('div', {
                            className:
                              'border-t border-(--ui-stroke-secondary)/40 px-3 py-2 text-[0.75rem] text-destructive whitespace-pre-wrap',
                            children: renderError
                          })
                        : null
                    ]
                  })
                : null,

              view === 'split' && showEditor && showPreview
                ? jsx(SplitSash, {
                    onLivePct: (pct) => {
                      sashDraggingRef.current = true
                      const el = leftPaneRef.current
                      if (el) el.style.width = `${pct}%`
                    },
                    onCommitPct: (pct) => {
                      sashDraggingRef.current = false
                      setSplitPct(pct)
                    },
                    onReset: () => {
                      sashDraggingRef.current = false
                      const el = leftPaneRef.current
                      if (el) el.style.width = '50%'
                      setSplitPct(50)
                    }
                  })
                : null,

              showPreview
                ? jsxs('div', {
                    className: cn(
                      'relative flex min-h-0 min-w-0 flex-col',
                      view === 'split' ? 'min-w-0 flex-1' : 'flex-1'
                    ),
                    children: [
                      jsx(PaneHeader, {
                        title: 'preview',
                        right: jsx(PreviewChrome, {})
                      }),
                      !source.trim()
                        ? jsx('div', {
                            className: 'flex flex-1 items-center justify-center p-6',
                            children: jsx(EmptyState, {
                              title: 'Empty diagram',
                              description: 'Write Mermaid source — preview updates live.'
                            })
                          })
                        : svg
                          ? jsx(SvgCanvas, { svg, fitKey: activePath || 'draft' })
                          : jsx('div', { className: 'relative min-h-0 flex-1' }),
                      jsx(CornerSpinner, { show: spinnerShow, label: spinnerLabel })
                    ]
                  })
                : null
            ]
          }),

      jsx('div', {
        className:
          'flex items-center gap-2 border-t border-(--ui-stroke-secondary)/40 px-3 py-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
        children: `${diagramsDir}  ·  drag pan · wheel zoom · autosave .mmd`
      }),

      // New diagram dialog
      jsxs(Dialog, {
        open: newOpen,
        onOpenChange: setNewOpen,
        children: [
          jsxs(DialogContent, {
            className: 'min-w-80',
            children: [
              jsxs(DialogHeader, {
                children: [
                  jsx(DialogTitle, { children: 'New diagram' }),
                  jsx(DialogDescription, {
                    children: `Saved as .mmd under ${relDir}`
                  })
                ]
              }),
              jsx(Input, {
                autoFocus: true,
                placeholder: 'photo-happy-path',
                value: newName,
                onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createDiagram()
                  }
                }
              }),
              jsxs(DialogFooter, {
                children: [
                  jsx(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => setNewOpen(false),
                    children: 'Cancel'
                  }),
                  jsx(Button, {
                    type: 'button',
                    size: 'sm',
                    disabled: !newName.trim() || busy === 'create',
                    onClick: () => void createDiagram(),
                    children: busy === 'create' ? 'Creating…' : 'Create'
                  })
                ]
              })
            ]
          })
        ]
      }),

      // Folder settings dialog
      jsxs(Dialog, {
        open: folderOpen,
        onOpenChange: setFolderOpen,
        children: [
          jsxs(DialogContent, {
            className: 'min-w-96',
            children: [
              jsxs(DialogHeader, {
                children: [
                  jsx(DialogTitle, { children: 'Diagrams folder' }),
                  jsx(DialogDescription, {
                    children:
                      'Per-project path. Relative paths resolve from the workspace cwd. Absolute paths are used as-is.'
                  })
                ]
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Input, {
                    value: folderDraft,
                    onChange: (e) => setFolderDraft(e.target.value),
                    placeholder: DEFAULT_REL_DIR,
                    className: 'flex-1 font-mono text-xs'
                  }),
                  jsx(Button, {
                    type: 'button',
                    size: 'sm',
                    variant: 'secondary',
                    onClick: () => void browseFolder(),
                    children: 'Browse'
                  })
                ]
              }),
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-quaternary) font-mono break-all',
                children: `→ ${resolveDiagramsDir(cwd, folderDraft.trim() || DEFAULT_REL_DIR)}`
              }),
              jsxs(DialogFooter, {
                children: [
                  jsx(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => void revealFolder(),
                    children: 'Reveal'
                  }),
                  jsx(Button, {
                    type: 'button',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => {
                      setFolderDraft(DEFAULT_REL_DIR)
                    },
                    children: 'Reset default'
                  }),
                  jsx(Button, {
                    type: 'button',
                    size: 'sm',
                    onClick: () => void applyFolder(),
                    children: 'Apply'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------

export default {
  id: 'mermaid-flow',
  name: 'Mermaid Flow',
  defaultEnabled: true,
  register(ctx) {
    storage = ctx.storage
    os = ctx.os

    const open = () => host.navigate('/mermaid-flow')

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/mermaid-flow' },
        render: () => jsx(FlowPage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: {
          path: '/mermaid-flow',
          label: 'Mermaid Flow',
          codicon: 'type-hierarchy-sub'
        }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'mermaid-flow.open',
          action: 'mermaid-flow.open',
          label: 'Open Mermaid Flow',
          keywords: ['mermaid', 'diagram', 'flow', 'docs'],
          run: open
        }
      },
      {
        id: 'open-key',
        area: KEYBINDS_AREA,
        data: {
          id: 'mermaid-flow.open',
          label: 'Open Mermaid Flow',
          category: 'Mermaid Flow',
          defaults: ['mod+shift+m'],
          run: open
        }
      }
    ])
  }
}
