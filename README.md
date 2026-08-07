# Mermaid Flow (Hermes Desktop plugin)

Project-backed Mermaid editor + live preview.

## Path

```text
~/.hermes/desktop-plugins/mermaid-flow/plugin.js
```

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
