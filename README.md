# Mermaid Flow

Mermaid Flow is a Hermes Desktop plugin for editing Mermaid diagrams as ordinary project files and previewing them live. Keep architecture, API, and UX flows next to the code instead of in a separate drawing tool.

- **Project-backed.** Default folder `{cwd}/docs/mermaid`, overridable per project.
- **Live preview.** Remote SVG via `mermaid.ink`, then `kroki.io`.
- **Split workflow.** Source | split | preview with a draggable sash.
- **Editor.** Syntax highlight, Mermaid completions, history, line cut/copy/delete/duplicate.
- **Canvas.** Pan, wheel zoom to cursor, double-click fit.
- **Formats.** Writes `*.mmd`; also reads `*.md` and `*.mermaid`.
- **Autosave.** Debounced ~`550 ms`.

## Example

```mermaid
flowchart LR
    Editor[Mermaid Flow] --> Disk["docs/mermaid/*.mmd"]
    Editor --> Remote[mermaid.ink / kroki.io]
    Remote --> Preview[Live SVG]
```

## Install

Desktop loads `$HERMES_HOME/desktop-plugins/mermaid-flow/plugin.js` (folder name = `id`).

```sh
mkdir -p ~/.hermes/desktop-plugins
git clone https://github.com/TOwInOK/mermaid-flow.git ~/.hermes/desktop-plugins/mermaid-flow
```

Update / remove:

```sh
git -C ~/.hermes/desktop-plugins/mermaid-flow pull
rm -rf ~/.hermes/desktop-plugins/mermaid-flow
```

Local copy / symlink (dev):

```sh
mkdir -p ~/.hermes/desktop-plugins/mermaid-flow
cp -R . ~/.hermes/desktop-plugins/mermaid-flow/
# or: ln -sfn "$(pwd)" ~/.hermes/desktop-plugins/mermaid-flow
```

After install: **Reload desktop plugins** → open a project → sidebar **Mermaid Flow** (`Mod+Shift+M`).

## Requirements

- Hermes Desktop with `// @include` support in `runtime-loader` (includes expand before import).
- Network access to `mermaid.ink` or `kroki.io` for SVG preview.
- Allowed imports only: `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` (no npm build step).

## Editor shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + X` | Cut current line when nothing is selected |
| `Ctrl/Cmd + C` | Copy current line when nothing is selected |
| `Ctrl/Cmd + Shift + K` | Delete current line |
| `Ctrl/Cmd + D` | Duplicate line / selection |
| `Tab` | Accept autocomplete suggestion |
| `Ctrl/Cmd + Space` | Open full completions |
| `Mod+Shift+M` | Open Mermaid Flow |

## Storage

| | |
| --- | --- |
| Default folder | `{cwd}/docs/mermaid` |
| Files | write `*.mmd`; read `*.mmd` / `*.md` / `*.mermaid` |
| Per-project path | Hermes storage keyed by `cwd` |
| Autosave | ~`550 ms` debounce |

Folder dialog:

- Relative path (from `cwd`) or absolute
- **Browse** — native picker
- **Reveal** — create folder if needed, open in file manager
- **Reset default** — restore `docs/mermaid`

## Source layout

```text
plugin.js                 # entry only: banner + // @include lines
src/
  00-preamble.js          # imports, constants, storage/os, $previewChrome
  10-core.js              # paths, FS helpers, normalize/pack, DnD
  20-syntax-editor.js     # highlight, completions, MermaidEditor
  30-preview.js           # mermaid.ink → kroki, sanitize, sash, SvgCanvas
  40-page-entry.js        # FlowPage + export default register
```

Include order (shared top-level scope after expand — not separate ESM modules):

```text
00-preamble.js → 10-core.js → 20-syntax-editor.js → 30-preview.js → 40-page-entry.js
```

Edit `src/*.js`. Hermes Desktop expands whole-line `// @include ./rel.js` when reading `plugin.js`; saves hot-reload after the loader change ships.
