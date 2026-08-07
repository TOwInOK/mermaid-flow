# Mermaid Flow (Hermes Desktop plugin)

Project-backed Mermaid editor + live preview.

## Path

```text
~/.hermes/desktop-plugins/mermaid-flow/
  plugin.js                 # entry only — list of // @include (loader expands)
  src/
    00-preamble.js          # imports, consts, storage/os, $previewChrome
    10-core.js              # path/FS, normalize/pack, hermes DnD helpers
    20-syntax-editor.js     # GH palette, highlight, completions, MermaidEditor
    30-preview.js           # remote SVG, sanitize, sash, SvgCanvas, chrome
    40-page-entry.js        # FlowPage (autosave/list/UI) + export default
```

| File | For |
|------|-----|
| `plugin.js` | Ship entry Hermes reads/watches. Only `@include` lines (+ banner). |
| `00-preamble.js` | One import block (`@hermes/plugin-sdk`, `react`, `jsx-runtime`), ZOOM/DEFAULT/STORAGE, `let storage`/`os`, `$previewChrome` atom. |
| `10-core.js` | `bridge`, path join/resolve, `fs*`, `normalizeMermaidSource` / `packSource`, drop-path helpers. No UI. |
| `20-syntax-editor.js` | Overlay highlighter + completion catalog + **MermaidEditor** (history, paste, line-cut, Ctrl+Space). Keep together. |
| `30-preview.js` | `renderRemoteSvg` (mermaid.ink → kroki), `sanitizeSvg`, sash, **SvgCanvas**, Preview/Source chrome. Keep sanitize next to canvas. |
| `40-page-entry.js` | **FlowPage** (list/load/autosave/DnD/toolbar) + `export default` `register`. |

**Order matters:** `00 → 10 → 20 → 30 → 40` (shared top-level scope after expand, not ESM).

Edit **`src/*.js`**. Hermes Desktop expands whole-line `// @include ./rel.js` when reading `plugin.js`. Frag + entry saves hot-reload after the desktop build that ships the loader change.

Needs desktop with `@include` support in `runtime-loader` (expand before Blob import).

## Use

1. Открой проект (`cwd` установлен)
2. `Reload desktop plugins`
3. Sidebar → **Mermaid Flow** (или `mod+shift+m`)
4. Схемы в папке **`docs/mermaid`** (настраиваемо на проект)
5. Выбери схему · `+` новая · иконка папки для смены пути

## Hotkeys

| Key                    | Action                          |
| ---------------------- | ------------------------------- |
| `Ctrl/Cmd + X`         | Cut line (if nothing selected)  |
| `Ctrl/Cmd + C`         | Copy line (if nothing selected) |
| `Ctrl/Cmd + Shift + K` | Delete line                     |
| `Ctrl/Cmd + D`         | Duplicate line                  |
| `Tab`                  | Autocomplete keyword            |
| `Ctrl/Cmd + Space`     | Completions                     |

## Storage

|                    |                                             |
| ------------------ | ------------------------------------------- |
| Default folder     | `{cwd}/docs/mermaid`                        |
| Files              | `*.mmd` (читает также `*.md` / `*.mermaid`) |
| Per-project folder | хранится в storage по `cwd`                 |
| Autosave           | debounced ~550ms                            |

## UI

- Hermes `Select` + `Dialog` + `Input` + `Button` + `GlyphSpinner`
- Спиннер в углу при загрузке/рендере (не на весь canvas)
- Pan/zoom на preview
- Preview: mermaid.ink → kroki.io

## Folder config

Кнопка папки → диалог:

- relative path (от `cwd`) или абсолютный
- **Browse** — нативный picker
- **Reveal** — создаёт папку и открывает файл-менеджер
- **Reset default** → `docs/mermaid`
