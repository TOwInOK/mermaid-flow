// DOM/React editor mechanics.

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
              "absolute z-30 max-h-56 min-w-52 max-w-80 overflow-auto rounded-[6px] border border-(--ui-stroke-secondary)/50 bg-(--ui-bg-elevated) py-1 text-xs text-(--ui-text-primary) shadow-lg",
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
                          "color-mix(in oklab, var(--ui-accent) 32%, var(--ui-bg-tertiary, --ui-bg-primary))",
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
