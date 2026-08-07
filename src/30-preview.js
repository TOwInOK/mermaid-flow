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
    // mermaid width="100%" + max-width:Npx fights pan/zoom. Pin CSS px = viewBox
    // units in the HTML string so React re-applying innerHTML cannot wipe the pin
    // (runtime-only pin was lost on commitView → wrong camera, correct %).
    const vbRaw = root.getAttribute("viewBox") || root.getAttribute("viewbox");
    let pinned = false;
    if (vbRaw) {
      const p = String(vbRaw)
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        p.length === 4 &&
        p.every((n) => Number.isFinite(n)) &&
        p[2] > 0 &&
        p[3] > 0
      ) {
        root.setAttribute("width", String(p[2]));
        root.setAttribute("height", String(p[3]));
        pinned = true;
      }
    }
    if (!pinned) {
      if (root.getAttribute("width") === "100%") root.removeAttribute("width");
      if (root.getAttribute("height") === "100%") root.removeAttribute("height");
    }
    const st = root.getAttribute("style") || "";
    const cleaned = st
      .split(";")
      .map((part) => part.trim())
      .filter(
        (part) =>
          part &&
          !/^max-width\s*:/i.test(part) &&
          !/^width\s*:/i.test(part) &&
          !/^height\s*:/i.test(part),
      );
    if (pinned) {
      const p = String(vbRaw)
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      cleaned.push(`width: ${p[2]}px`, `height: ${p[3]}px`, "max-width: none");
    }
    if (cleaned.length) root.setAttribute("style", cleaned.join("; "));
    else root.removeAttribute("style");
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

  /** Mermaid ships viewBox as the true diagram frame; getBBox can be node-local
   *  or FO-incomplete and then auto-fit zooms to 250% on the first node. */
  const diagramBounds = useCallback((svgEl) => {
    if (!svgEl) return null;
    const vb = svgEl.getAttribute("viewBox") || svgEl.getAttribute("viewbox");
    if (vb) {
      const p = String(vb)
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (p.length === 4 && p.every((n) => Number.isFinite(n)) && p[2] > 0 && p[3] > 0) {
        return { ox: p[0], oy: p[1], w: p[2], h: p[3], via: "viewBox" };
      }
    }
    try {
      const box = svgEl.getBBox();
      if (box.width > 0 && box.height > 0) {
        return {
          ox: box.x,
          oy: box.y,
          w: box.width,
          h: box.height,
          via: "bbox",
        };
      }
    } catch {
      /* FO / not laid out yet */
    }
    const w = svgEl.clientWidth || 0;
    const h = svgEl.clientHeight || 0;
    if (w > 0 && h > 0) return { ox: 0, oy: 0, w, h, via: "client" };
    return null;
  }, []);

  const fitView = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return false;
    const svgEl = content.querySelector("svg");
    if (!svgEl) return false;
    const b = diagramBounds(svgEl);
    if (!b || !(b.w > 0 && b.h > 0)) return false;

    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    // Not laid out yet — caller retries (rAF / ResizeObserver).
    if (!(vpW > 8 && vpH > 8)) return false;

    // Pin 1 CSS px = 1 viewBox unit (sanitizeSvg also bakes this into HTML).
    svgEl.style.maxWidth = "none";
    svgEl.style.width = `${b.w}px`;
    svgEl.style.height = `${b.h}px`;
    svgEl.setAttribute("width", String(b.w));
    svgEl.setAttribute("height", String(b.h));

    const pad = 32;
    const nextScale = clampZoom(
      Math.min(
        Math.max(1, vpW - pad * 2) / b.w,
        Math.max(1, vpH - pad * 2) / b.h,
        1,
      ),
    );
    // viewBox origin (usually 0,0) — center the pinned box in the viewport.
    commitView({
      scale: nextScale,
      tx: (vpW - b.w * nextScale) / 2 - b.ox * nextScale,
      ty: (vpH - b.h * nextScale) / 2 - b.oy * nextScale,
    });
    return true;
  }, [commitView, diagramBounds]);

  const normalizeSvgEl = useCallback(() => {
    const svgEl = contentRef.current?.querySelector("svg");
    if (!svgEl) return;
    const b = diagramBounds(svgEl);
    svgEl.style.maxWidth = "none";
    if (b) {
      svgEl.style.width = `${b.w}px`;
      svgEl.style.height = `${b.h}px`;
      svgEl.setAttribute("width", String(b.w));
      svgEl.setAttribute("height", String(b.h));
    } else {
      svgEl.style.width = "auto";
      svgEl.style.height = "auto";
      svgEl.removeAttribute("width");
      if (svgEl.getAttribute("height") === "100%")
        svgEl.removeAttribute("height");
    }
  }, [diagramBounds]);

  // Re-pin + re-paint after every commit (innerHTML / state). No setState here.
  useEffect(() => {
    normalizeSvgEl();
    paintDom(viewRef.current);
  });

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

  // Auto-fit once per fitKey when SVG is ready. Retry until vp has size —
  // otherwise resetView(1,0,0) sticks: correct % , camera on first node.
  useEffect(() => {
    if (!svg) return;
    const key = fitKey ?? "";
    let cancelled = false;
    let tries = 0;
    const maxTries = 24;

    const attempt = () => {
      if (cancelled) return;
      if (fittedForKey.current === key) return;
      normalizeSvgEl();
      if (fitView()) {
        fittedForKey.current = key;
        return;
      }
      tries += 1;
      if (tries < maxTries) requestAnimationFrame(attempt);
    };

    const t = requestAnimationFrame(attempt);
    const el = viewportRef.current;
    let ro = null;
    if (typeof ResizeObserver !== "undefined" && el) {
      ro = new ResizeObserver(() => {
        if (cancelled || fittedForKey.current === key) return;
        normalizeSvgEl();
        if (fitView()) fittedForKey.current = key;
      });
      ro.observe(el);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(t);
      ro?.disconnect();
    };
  }, [svg, fitKey, normalizeSvgEl, fitView]);

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

  return jsxs("div", {
    className: "relative flex min-h-0 flex-1 flex-col",
    children: [
      jsx("div", {
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
      // zoom chip floats over SVG (same corner as old header-right)
      jsx("div", {
        className: "pointer-events-auto absolute top-2 right-2 z-20",
        children: jsx(PreviewChrome, {}),
      }),
    ],
  });
}

/** Zoom chip over the mermaid canvas. */
function PreviewChrome() {
  const chrome = useValue($previewChrome);
  if (!chrome) return null;
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

