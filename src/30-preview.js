function isDarkUi() {
  try {
    const bg =
      getComputedStyle(document.body).backgroundColor ||
      getComputedStyle(document.documentElement).backgroundColor ||
      "";
    const m = String(bg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return true;
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  } catch {
    return true;
  }
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function withThemeDirective(code, dark) {
  const trimmed = code.trim();
  if (!trimmed) return "";
  if (
    /%%\s*\{\s*init\s*:/i.test(trimmed) ||
    /theme\s*:/i.test(trimmed.slice(0, 200))
  ) {
    return trimmed;
  }
  if (!dark) return trimmed;
  return `%%{init: {'theme':'dark'}}%%\n${trimmed}`;
}

async function renderRemoteSvg(code, dark, signal) {
  const themed = withThemeDirective(normalizeMermaidSource(code), dark);
  if (!themed) return { kind: "empty" };

  const encoded = utf8ToBase64(themed);
  if (encoded.length < 6000) {
    try {
      const res = await fetch(`https://mermaid.ink/svg/${encoded}`, {
        signal,
        mode: "cors",
      });
      if (res.ok) {
        const svg = await res.text();
        if (svg.includes("<svg"))
          return { kind: "ok", svg, via: "mermaid.ink" };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  const res = await fetch("https://kroki.io/mermaid/svg", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: themed,
    signal,
    mode: "cors",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(
      `render failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const svg = await res.text();
  if (!svg.includes("<svg")) throw new Error("render returned non-SVG body");
  return { kind: "ok", svg, via: "kroki" };
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** DOMParser sanitize for remote SVG (dangerouslySetInnerHTML).
 * Keep foreignObject — mermaid htmlLabels live there; scrub kids only. */
function sanitizeSvg(raw) {
  const input = String(raw || "");
  if (!input.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(input, "image/svg+xml");
    const parseErr = doc.querySelector("parsererror");
    if (parseErr) return "";
    const root = doc.documentElement;
    if (!root || String(root.tagName).toLowerCase() !== "svg") return "";

    // Kill active content; keep foreignObject (mermaid labels = HTML inside FO).
    const DENY = new Set([
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      "input",
      "button",
      "textarea",
      "select",
    ]);

    const scrubAttrs = (node) => {
      if (!node?.attributes) return;
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name;
        const lname = name.toLowerCase();
        if (lname.startsWith("on") || lname === "srcdoc") {
          node.removeAttribute(name);
          continue;
        }
        if (
          lname === "href" ||
          lname === "xlink:href" ||
          lname === "src" ||
          lname === "action" ||
          lname === "formaction" ||
          lname.endsWith(":href")
        ) {
          const v = String(attr.value || "").trim();
          const low = v.toLowerCase();
          // No scheme-relative //host — startsWith('/') alone would allow it.
          const ok =
            !v ||
            low.startsWith("#") ||
            (low.startsWith("/") && !low.startsWith("//")) ||
            low.startsWith("./") ||
            low.startsWith("../") ||
            low.startsWith("http://") ||
            low.startsWith("https://");
          if (!ok) node.removeAttribute(name);
        }
        // style: drop expression()/url(javascript:...)
        if (lname === "style") {
          const st = String(attr.value || "");
          if (/expression\s*\(|javascript:|@import/i.test(st))
            node.removeAttribute(name);
        }
      }
    };

    const walk = (el) => {
      // childNodes: FO may hold text + HTML elements
      const kids = Array.from(el.childNodes || []);
      for (const child of kids) {
        if (child.nodeType === 1 /* ELEMENT */) {
          const tag = String(child.tagName || "")
            .toLowerCase()
            .replace(/^.*:/, "");
          if (DENY.has(tag)) {
            child.remove();
            continue;
          }
          scrubAttrs(child);
          walk(child);
        }
      }
    };
    scrubAttrs(root);
    walk(root);
    // mermaid width/height 100% breaks pan/zoom framing
    if (root.getAttribute("width") === "100%") root.removeAttribute("width");
    if (root.getAttribute("height") === "100%") root.removeAttribute("height");
    const st = root.getAttribute("style");
    if (st && /max-width/i.test(st)) {
      root.setAttribute(
        "style",
        st
          .split(";")
          .map((p) => p.trim())
          .filter((p) => p && !/^max-width\s*:/i.test(p))
          .join("; "),
      );
    }
    return new XMLSerializer().serializeToString(root);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------

function ToolbarButton(props) {
  const { tip, onClick, children, variant, disabled } = props;
  const btn = jsx(Button, {
    type: "button",
    size: "xs",
    variant: variant || "ghost",
    disabled: !!disabled,
    onClick: () => {
      haptic("tap");
      onClick?.();
    },
    children,
  });
  if (!tip) return btn;
  return jsx(Tip, { label: tip, children: btn });
}

function CornerSpinner({ show, label }) {
  if (!show) return null;
  return jsx(Tip, {
    label: label || "Loading…",
    children: jsx("div", {
      className:
        "pointer-events-none absolute right-2 bottom-2 z-20 flex items-center gap-1.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary) shadow-sm backdrop-blur-sm",
      children: jsxs("span", {
        className: "inline-flex items-center gap-1.5",
        children: [
          jsx(GlyphSpinner, { className: "text-(--ui-text-secondary)" }),
          label || "…",
        ],
      }),
    }),
  });
}

const SPLIT_MIN = 18;
const SPLIT_MAX = 82;

/**
 * Vertical sash matching Hermes pane-shell (`tree-split.tsx` Sash):
 * 9px hit target, hairline at opacity-10 → full on hover, thicker
 * `--ui-sash-hover-border` band on hover. No grip dots.
 */
function SplitSash({ onLivePct, onCommitPct, onReset }) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const lastPctRef = useRef(null);

  const measurePct = (e) => {
    // Parent is the split row (source | sash | preview).
    const row = e.currentTarget.parentElement?.parentElement;
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    return Math.min(
      SPLIT_MAX,
      Math.max(SPLIT_MIN, ((e.clientX - rect.left) / rect.width) * 100),
    );
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const pct = measurePct(e);
    if (pct == null) return;
    lastPctRef.current = pct;
    onLivePct?.(pct);
  };

  const endDrag = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const pct = lastPctRef.current ?? measurePct(e);
    lastPctRef.current = null;
    if (pct != null) onCommitPct?.(pct);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
  };

  return jsx("div", {
    className: "relative z-20 w-0 shrink-0 self-stretch",
    children: jsxs("div", {
      role: "separator",
      "aria-orientation": "vertical",
      "data-slot": "pane-resize-handle",
      title: "Drag to resize · double-click to reset",
      className: cn(
        "group/sash absolute inset-y-0 left-0 z-20 w-[9px] -translate-x-1/2 cursor-col-resize",
        "[-webkit-app-region:no-drag]",
      ),
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: (e) => {
        e.preventDefault();
        onReset?.();
      },
      children: [
        // Persistent hairline — same token as pane-shell seams.
        jsx("span", {
          className: cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
            "bg-(--ui-stroke-secondary) transition-opacity duration-100",
            dragging
              ? "opacity-100"
              : "opacity-10 group-hover/sash:opacity-100",
          ),
        }),
        // Hover / active grab band (vscode-sash-hover-size, default 4px).
        jsx("span", {
          className: cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-(--vscode-sash-hover-size,0.25rem) -translate-x-1/2",
            "bg-(--ui-sash-hover-border) transition-opacity duration-100",
            dragging ? "opacity-100" : "opacity-0 group-hover/sash:opacity-100",
          ),
        }),
      ],
    }),
  });
}

function SvgCanvas({ svg, fitKey }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  const lastFitKey = useRef(null);
  const fittedForKey = useRef(null);
  const chromePctAt = useRef(0);
  const chromeActionsRef = useRef({
    zoomIn: () => {},
    zoomOut: () => {},
    reset: () => {},
    fit: () => {},
  });
  const safeSvg = useMemo(() => sanitizeSvg(svg), [svg]);

  const paintDom = useCallback((v) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    el.style.transformOrigin = "0 0";
  }, []);

  // Parent re-renders (source/svg) must not wipe mid-gesture DOM transform.
  useEffect(() => {
    paintDom(viewRef.current);
  });

  const pushChrome = useCallback((pct) => {
    const a = chromeActionsRef.current;
    $previewChrome.set({
      pct,
      zoomIn: a.zoomIn,
      zoomOut: a.zoomOut,
      reset: a.reset,
      fit: a.fit,
    });
  }, []);

  // Commit React state (gesture end / Fit / reset). Mid-gesture uses paintDom only.
  const commitView = useCallback(
    (next) => {
      const v = { scale: clampZoom(next.scale), tx: next.tx, ty: next.ty };
      viewRef.current = v;
      paintDom(v);
      setScale(v.scale);
      setTx(v.tx);
      setTy(v.ty);
      chromePctAt.current = Date.now();
      pushChrome(Math.round(v.scale * 100));
    },
    [paintDom, pushChrome],
  );

  // Imperative mid-gesture: DOM + optional throttled chrome pct.
  const liveView = useCallback(
    (next) => {
      const v = { scale: clampZoom(next.scale), tx: next.tx, ty: next.ty };
      viewRef.current = v;
      paintDom(v);
      const now = Date.now();
      // ponytail: throttle 100ms chrome; rAF batch if still janky
      if (now - chromePctAt.current >= 100) {
        chromePctAt.current = now;
        pushChrome(Math.round(v.scale * 100));
      }
    },
    [paintDom, pushChrome],
  );

  const resetView = useCallback(
    () => commitView({ scale: 1, tx: 0, ty: 0 }),
    [commitView],
  );

  const fitView = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const svgEl = content.querySelector("svg");
    if (!svgEl) return;
    let w = 0;
    let h = 0;
    let ox = 0;
    let oy = 0;
    try {
      const box = svgEl.getBBox();
      w = box.width;
      h = box.height;
      ox = box.x;
      oy = box.y;
    } catch {
      w = svgEl.clientWidth || 0;
      h = svgEl.clientHeight || 0;
    }
    if (!(w > 0 && h > 0)) return;
    const pad = 32;
    const nextScale = clampZoom(
      Math.min(
        (vp.clientWidth - pad * 2) / w,
        (vp.clientHeight - pad * 2) / h,
        2.5,
      ),
    );
    commitView({
      scale: nextScale,
      tx: (vp.clientWidth - w * nextScale) / 2 - ox * nextScale,
      ty: (vp.clientHeight - h * nextScale) / 2 - oy * nextScale,
    });
  }, [commitView]);

  const normalizeSvgEl = useCallback(() => {
    const svgEl = contentRef.current?.querySelector("svg");
    if (!svgEl) return;
    svgEl.style.maxWidth = "none";
    svgEl.style.width = "auto";
    svgEl.style.height = "auto";
    svgEl.removeAttribute("width");
    if (svgEl.getAttribute("height") === "100%")
      svgEl.removeAttribute("height");
  }, []);

  const zoomBy = useCallback(
    (factor) => {
      const el = viewportRef.current;
      const cur = viewRef.current;
      const rect = el?.getBoundingClientRect();
      const mx = rect ? rect.width / 2 : 0;
      const my = rect ? rect.height / 2 : 0;
      const nextScale = clampZoom(cur.scale * factor);
      const k = nextScale / cur.scale;
      commitView({
        scale: nextScale,
        tx: mx - k * (mx - cur.tx),
        ty: my - k * (my - cur.ty),
      });
    },
    [commitView],
  );

  // File switch → allow one auto-fit for the next successful SVG.
  useEffect(() => {
    const key = fitKey ?? "";
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    fittedForKey.current = null;
    resetView();
  }, [fitKey, resetView]);

  // Source edits re-render SVG — keep pan/zoom. Only normalize attributes.
  // Auto-fit once per fitKey when SVG first becomes available.
  useEffect(() => {
    if (!svg) return;
    const key = fitKey ?? "";
    const t = requestAnimationFrame(() => {
      normalizeSvgEl();
      paintDom(viewRef.current);
      if (fittedForKey.current !== key) {
        fittedForKey.current = key;
        requestAnimationFrame(() => fitView());
      }
    });
    return () => cancelAnimationFrame(t);
  }, [svg, fitKey, normalizeSvgEl, fitView, paintDom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cur = viewRef.current;
      if (e.shiftKey || e.altKey) {
        liveView({
          scale: cur.scale,
          tx: cur.tx + (e.shiftKey ? -e.deltaY : -e.deltaX),
          ty: cur.ty + (e.shiftKey ? 0 : -e.deltaY),
        });
        return;
      }
      const direction = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const factor =
        e.ctrlKey || e.metaKey ? Math.pow(direction, 0.55) : direction;
      const nextScale = clampZoom(cur.scale * factor);
      const k = nextScale / cur.scale;
      liveView({
        scale: nextScale,
        tx: mx - k * (mx - cur.tx),
        ty: my - k * (my - cur.ty),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [liveView]);

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const cur = viewRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty };
    setGrabbing(true);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    liveView({
      scale: viewRef.current.scale,
      tx: d.tx + (e.clientX - d.x),
      ty: d.ty + (e.clientY - d.y),
    });
  };
  const endDrag = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGrabbing(false);
    // one React commit after pan
    commitView(viewRef.current);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
  };

  // Wire chrome actions (stable via ref); pct from live/commit.
  useEffect(() => {
    chromeActionsRef.current = {
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      reset: () => resetView(),
      fit: () => fitView(),
    };
    pushChrome(Math.round(viewRef.current.scale * 100));
    return () => {
      $previewChrome.set(null);
    };
  }, [zoomBy, resetView, fitView, pushChrome]);

  return jsx("div", {
    className: "relative flex min-h-0 flex-1 flex-col",
    children: jsx("div", {
      ref: viewportRef,
      className: cn(
        "relative min-h-0 flex-1 overflow-hidden touch-none",
        grabbing ? "cursor-grabbing" : "cursor-grab",
      ),
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: (e) => {
        e.preventDefault();
        fitView();
      },
      children: jsx("div", {
        ref: contentRef,
        className: "origin-top-left will-change-transform select-none",
        style: {
          transformOrigin: "0 0",
        },
        dangerouslySetInnerHTML: { __html: safeSvg },
      }),
    }),
  });
}

/** Shared pane header — same height/padding for SOURCE and PREVIEW. */
function PaneHeader({ title, right }) {
  return jsxs("div", {
    className:
      "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--ui-stroke-secondary)/30 px-3 text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)",
    children: [
      jsx("span", { className: "leading-none", children: title }),
      jsx("div", {
        className: "flex h-7 items-center justify-end",
        children: right || null,
      }),
    ],
  });
}

/** Zoom controls for the PREVIEW header row. */
function PreviewChrome() {
  const chrome = useValue($previewChrome);
  if (!chrome) {
    // Keep header height stable while canvas mounts.
    return jsx("div", { className: "h-7 w-[7.5rem]" });
  }
  return jsxs("div", {
    className:
      "flex h-7 items-center gap-0.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-1 shadow-sm backdrop-blur-sm",
    children: [
      jsx(ToolbarButton, {
        tip: "Zoom out",
        onClick: () => chrome.zoomOut(),
        children: jsx(Codicon, { name: "zoom-out" }),
      }),
      jsx("button", {
        type: "button",
        className:
          "w-12 shrink-0 rounded-[3px] px-0 py-0.5 text-center text-[0.6875rem] tabular-nums normal-case text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground",
        title: "Reset to 100%",
        onClick: () => {
          haptic("tap");
          chrome.reset();
        },
        children: `${chrome.pct}%`,
      }),
      jsx(ToolbarButton, {
        tip: "Zoom in",
        onClick: () => chrome.zoomIn(),
        children: jsx(Codicon, { name: "zoom-in" }),
      }),
      jsx(ToolbarButton, {
        tip: "Fit",
        onClick: () => chrome.fit(),
        children: jsx(Codicon, { name: "screen-full" }),
      }),
    ],
  });
}

/** Status chip for SOURCE header — mirrors PreviewChrome footprint. */
function SourceChrome({ dirty, onSave, disabled }) {
  return jsxs("div", {
    className:
      "flex h-7 items-center gap-0.5 rounded-[5px] bg-(--ui-bg-tertiary)/90 px-1 shadow-sm backdrop-blur-sm",
    children: [
      jsx("span", {
        className: cn(
          "min-w-12 px-1.5 text-center text-[0.6875rem] tabular-nums normal-case",
          dirty ? "text-(--ui-text-secondary)" : "text-(--ui-text-quaternary)",
        ),
        children: dirty ? "dirty" : "saved",
      }),
      jsx(ToolbarButton, {
        tip: dirty ? "Save now" : "Saved",
        disabled: disabled || !dirty,
        onClick: onSave,
        children: jsx(Codicon, { name: "save" }),
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

