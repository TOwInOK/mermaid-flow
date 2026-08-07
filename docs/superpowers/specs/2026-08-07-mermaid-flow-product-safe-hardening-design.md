# mermaid-flow — product-safe hardening (Approach B)

**Date:** 2026-08-07  
**Target:** `~/.hermes/desktop-plugins/mermaid-flow/plugin.js` (+ `README.md`)  
**Status:** design approved direction **B** (user: «делай B»)  
**Sources:** 3-way audit (`gpt-5.6-sol`, `kimi-k3`, `grok-4-5`)  
**Mode:** ponytail full — shortest correct diffs; no multi-file split; no new deps

---

## 1. Goal and boundaries

### Goal

Hardening only: fix data-loss / security / FM-spam / gesture re-render thrash / free dead chrome.  
**Do not** remove highlighter or Ctrl+Space completions shell.

### Product-keep (locked)

- Overlay syntax highlighter (dual-surface editor)
- Completions + **Ctrl+Space** (catalog trim optional later, not required in B)
- `fitKey` zoom preserve on source edit
- Native Hermes sash chrome (hairline / tokens / dblclick 50%)
- Files-tree DnD (`application/x-hermes-paths`)
- Ctrl/Cmd+X line cut (and related line ops via `e.code`)

### In scope (B)

| Area | Change |
|------|--------|
| Editor history | Paste through single history path + caret restore |
| SVG security | `sanitizeSvg` → DOMParser allowlist |
| Autosave | Single-flight write + clear timer + **unmount flush** + optional ENOENT retry |
| FS | `fsEnsureDir({ open: false })` must **not** open file manager |
| Chrome cut | Drop StatusChip + STATUSBAR; drop openLive + mermaid.live button; README drop Ctrl+Enter live |
| Copy | 3 → 2: keep **Copy source** + **Copy SVG**; drop **Fence** (or fold fence into source tip — prefer drop Fence button) |
| Tokens | Remove `#3b82f6` / hard `rgb(20,20,20)` fallbacks |
| Dead code | Delete unused `arrow` regex line |
| Sash | Mid-drag: ref/native width; `setSplitPct` + storage **on pointerup** only |
| SvgCanvas | Mid-gesture: transform via ref/DOM; throttle zoom % publish to `$previewChrome` |
| Light polish | `useMemo` for highlight HTML if cheap; storage map copy-on-write |

### Out of scope

- Delete highlighter / gut completions catalog / drop extractDocIds
- Multi-file split of `plugin.js`
- New npm deps, offline mermaid, iframe CDN
- LSP / CodeMirror import
- Changing remote SVG ladder (ink → kroki) shape
- Global `storage`/`os` DI refactor (low ROI)

### Success criteria

1. Paste then Ctrl+Z undoes paste (history stack not reset to single entry).
2. Navigate away from `/mermaid-flow` with dirty buffer → pending autosave flushed or timer cancelled after flush (no silent drop of last ~550ms window).
3. Create diagram when folder missing with `open:false` → dir created **without** OS file manager; Reveal still opens FM.
4. Drag sash / pan-zoom large SVG → no full `FlowPage` re-render every pointermove (sash); canvas pan/zoom does not triple-setState every tick.
5. No statusbar «flow» chip; no mermaid.live toolbar control; README has no Ctrl+Enter live row.
6. Reload desktop plugins → no load toast; route still opens from sidebar / palette / keybind.

### Files

- `plugin.js` — all behavior
- `README.md` — hotkeys table only
- This spec under `docs/superpowers/specs/`

---

## 2. Data / security paths

### 2.1 Paste → one history path

**Bug:** `FlowPage.onSourcePaste` calls `setSource(normalize(merged))` directly. `MermaidEditor` external-value effect sees `value !== lastEmitted` and resets `stack = [v]`. Undo after paste is dead.

**Design (root cause in editor):**

1. Move paste normalize into `MermaidEditor` `onPaste` handler (or shared helper called only there):
   - `preventDefault`
   - merge selection + clipboard
   - `normalizeMermaidSource(merged)`
   - `emit(next, caret, { coalesce: false })` so `pushHistory` runs once
2. `FlowPage` paste prop becomes thin: only `setDirty` / `scheduleSave` if needed — **or** parent learns dirty from normal `onChange` only (prefer: paste emits via `onChange` path already used by typing).
3. Do **not** call parent `setSource` around history.

**Caret:** `pendingCaret` = start + inserted length (or expandInsert-style); not EOF-only.

**Verify:** paste multi-line → Ctrl+Z restores pre-paste; caret sane.

### 2.2 `sanitizeSvg` allowlist

**Bug:** regex strip only quoted `on*` + `<script>`; `foreignObject`, bare handlers, `javascript:` / `data:` href survive → `dangerouslySetInnerHTML`.

**Design (lazy DOMParser, no new dep):**

```text
parse → walk elements → remove script, foreignObject, and disallowed tags
strip all on* attributes
for href / xlink:href / src: drop if javascript: or data: (except data:image/ for mermaid if needed — default: drop data: too unless image/svg+xml proven needed; prefer drop all non-https/http/relative fragment)
return outerHTML of svg root
keep existing width/height 100% strip behavior on root or via attr cleanup
```

**Ceiling:** `ponytail: DOMParser allowlist, full SVG CSP sandbox if threat model upgrades`.

**Verify:** malicious fixture string with `<foreignObject><script>` and `href="javascript:…"` → not present in output; normal mermaid.ink SVG still paints.

### 2.3 Autosave single-flight + unmount flush

**Bugs:**

- `flushSave` does not `clearTimeout(saveTimer)` at entry → manual Save + pending 550ms → double write.
- No write generation guard → overlapping `fsWriteText`.
- No unmount cleanup → last dirty window lost / write after unmount.

**Design:**

1. At start of `flushSave`: `clearTimeout(saveTimer); saveTimer = null`.
2. `saveGen` ref: increment at start; after `await`, ignore if gen stale; only clear dirty if gen matches and path/body still current (path from ref as now).
3. `useEffect(() => () => { clearTimeout; void flushSave() }, [])` on `FlowPage` (or deps stable flushSave) — unmount / route leave.
4. Optional: on `ENOENT` / parent missing, one `fsEnsureDir(dir, { open: false })` then retry write once (same as create, without FM).

**Verify:** type → immediate Save → no second write toast/error; dirty edit → navigate away → file on disk has last content.

### 2.4 `fsEnsureDir({ open: false })` honesty

**Bug:** comment says no FM; implementation always `openDir` when dir missing → FM opens on first create.

**Design:**

1. Probe `readDir` (keep).
2. If missing and `open === false`: need **mkdir without reveal**.
   - Prefer bridge API if exists (`mkdir`, `ensureDir`, etc.) — discover on `window.hermesDesktop` at implement time.
   - If **only** `openDir` exists: call it then document unavoidable FM **or** use `openDir` only when `open:true`; for create path accept one-time FM only if no mkdir — **must re-check bridge** before coding.
   - **Required outcome for B:** create path with existing parent works; missing leaf dir without FM if platform allows; if platform cannot mkdir silently, note in plan and use least-spam path (single openDir max, not dual retry that opens twice).
3. `open: true` (Reveal): keep openDir.
4. Collapse `createDiagram` dual retry once ensure is honest (delete redundant second open:true retry if ensure already created).

**Verify:** empty project → New diagram → folder appears, **FM does not** pop (if mkdir available); Reveal button still opens FM.

---

## 3. Free chrome cuts

| Item | Action |
|------|--------|
| `StatusChip` + `STATUSBAR_AREAS.right` register | **Delete** |
| `openLive` + toolbar external link button | **Delete** |
| README hotkey `Ctrl/Cmd+Enter` → mermaid.live | **Delete row** |
| Copy Fence button | **Delete** (keep Copy source + Copy SVG) |
| `#3b82f6` in completion selected style | Use `var(--ui-accent)` only, no hex fallback |
| `isDarkUi` fallback `rgb(20,20,20)` | Prefer `true` (dark) without hard rgb string, or read token without inventing hex |
| Dead `const arrow = …` (unused vs `arrow2`) | **Delete** |
| Storage maps `map[k]=…; set(map)` same ref | `set({ ...map, [k]: v })` |

**Keep:** nav, palette, keybind `mod+shift+m`, Save, Copy source, Copy SVG.

---

## 4. Gesture performance

### 4.1 Sash — commit on pointerup

**Now:** every move → `setSplitPct` → full `FlowPage` re-render + storage write.

**Design:**

1. Mid-drag: measure row rect; set **left pane** `style.width` via ref (or CSS variable on split row ref).
2. Do **not** call `setSplitPct` / storage during move.
3. On pointerup / pointercancel: clamp pct → `setSplitPct` once → existing storage effect runs once.
4. Dblclick reset: set 50% state as now.
5. Visual: hairline / tokens / hit target **unchanged** (product-keep).

### 4.2 SvgCanvas — ref transform + throttle chrome

**Now:** `applyView` always `setScale/setTx/setTy`; wheel/drag every tick; `$previewChrome` effect on every `pct`.

**Design:**

1. Keep `viewRef` as source of truth during gestures.
2. Apply `contentRef.style.transform = translate(tx)px scale(s)` (and origin) **imperatively** in wheel/pointermove.
3. React state for scale/tx/ty: update on **gesture end**, Fit, reset, fitKey auto-fit — so non-gesture renders stay correct.
4. `$previewChrome.pct`: throttle ~100ms during gesture **or** update only on end + Fit; zoom buttons still call imperative apply + publish.
5. Do **not** re-`sanitizeSvg` / replace innerHTML on pan (already only when `svg` prop changes — keep that; avoid re-render is the main win).
6. `fitKey` behavior **unchanged**: one auto-fit per key; source edits keep pan/zoom.

**Ceiling:** `ponytail: throttle 100ms chrome; rAF batch if still janky`.

---

## 5. Light polish (same pass if cheap)

| Item | Action |
|------|--------|
| `highlightMermaidHtml` | Prefer `useMemo([value, darkFlag])` over rAF+`setHtml` if dark flag stable |
| `extractDocIds` | Optional memo by source string in completions open path — **do not** delete |
| Undo caret EOF | If touch `applyHistoryTo` for paste: store caret in history entries **only if** small; else leave for later |
| createDiagram dual path | Simplify after fsEnsureDir fix |

---

## 6. Architecture note

Still **one** disk plugin file. No new modules. Changes stay local to existing functions:

`MermaidEditor` · `sanitizeSvg` · `flushSave`/`scheduleSave` · `fsEnsureDir` · `SplitSash`/`FlowPage` split row · `SvgCanvas` · `register()` · README.

---

## 7. Error handling

- Save/flush failures: existing `host.notify` error; dirty stays true.
- Sanitize empty / parse fail: return empty string or previous safe empty svg; do not throw into canvas.
- Unmount flush failure: notify if possible; do not block unmount.
- mkdir unavailable: notify once on create; no infinite openDir loop.

---

## 8. Verification (manual)

After **Reload desktop plugins**:

1. Open Mermaid Flow → no toast; no statusbar chip.
2. Paste block with fences → diagram normalizes → Ctrl+Z restores previous source.
3. Edit → wait <550ms → switch session/route away → reopen file → content saved.
4. Delete diagrams dir externally → New file → no double FM spam; file created.
5. Drag sash: editor does not visibly hitch; after release split persists reload.
6. Pan/zoom large diagram: smooth; Fit still works; edit source does not reset zoom (`fitKey`).
7. Toolbar: no live link; Copy source + SVG work; Fence gone.
8. Completions Ctrl+Space still works; highlighter still paints.

No automated test harness in disk plugin — manual checklist is the check.

---

## 9. Implementation order (for writing-plans)

1. Paste history path  
2. sanitizeSvg DOMParser  
3. Autosave single-flight + unmount  
4. fsEnsureDir + create simplify  
5. Chrome deletes + README + tokens + dead arrow + storage copy  
6. Sash commit-on-up  
7. SvgCanvas ref-transform + throttle chrome  
8. useMemo highlight (if still easy)  
9. Manual verify checklist  

---

## 10. net estimate

| | Δ LOC (approx) |
|--|----------------|
| Product-safe B | **−40 … −90** net (sanitize/canvas may add lines; chrome deletes free more) |
| Touch churn | ~150–250 lines edited |

---

## 11. Non-goals reminder

Sol’s «delete highlighter (−280)» and gut completions — **rejected** for this design (product-keep + authoring skill).

---

## 12. Open implement-time check

- Exact `window.hermesDesktop` mkdir API name (if any) for silent ensure — resolve by reading bridge usage / app types at implement, not invent.
