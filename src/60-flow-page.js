function FlowStatusItem() {
  const status = useValue($flowStatus);
  const active = [
    "listing",
    "loading",
    "creating",
    "saving",
    "updating",
    "rendering",
  ].includes(status.state);
  const label = status.state === "ready" ? "ready" : status.state;
  return jsx(Tip, {
    label: status.detail || `Mermaid Flow: ${label}`,
    children: jsxs("span", {
      className:
        "inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)",
      children: [
        active
          ? jsx(GlyphSpinner, { className: "text-(--ui-text-secondary)" })
          : null,
        `mermaid: ${label}`,
      ],
    }),
  });
}

function FlowPage() {
  const cwd = useValue(host.state.cwd);

  const projectKey = cwd || "__none__";

  const [relDir, setRelDir] = useState(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {};
    return map[projectKey] || DEFAULT_REL_DIR;
  });
  const diagramsDir = useMemo(
    () => resolveDiagramsDir(cwd, relDir),
    [cwd, relDir],
  );

  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState(
    () => storage?.get(STORAGE_VIEW, "split") || "split",
  );
  const [splitOrient, setSplitOrient] = useState(() => {
    const o = storage?.get(STORAGE_SPLIT_ORIENT, "vertical");
    return o === "horizontal" ? "horizontal" : "vertical";
  });
  const [splitPct, setSplitPct] = useState(() => {
    const n = Number(storage?.get(STORAGE_SPLIT, 50));
    return Number.isFinite(n)
      ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n))
      : 50;
  });
  const [svg, setSvg] = useState("");
  const [via, setVia] = useState("");
  const [renderError, setRenderError] = useState("");
  const [fsError, setFsError] = useState("");
  const [busy, setBusy] = useState(""); // '' | list | file | render | save | create
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState(relDir);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // Bumps on every successful loadFile so same-path drop/Select re-runs preview
  // (effect deps are only debounced+activePath otherwise → setSvg("") sticks).
  const [fileLoadId, setFileLoadId] = useState(0);

  const genRef = useRef(0);
  const saveTimer = useRef(null);
  const saveGenRef = useRef(0);
  const activePathRef = useRef("");
  const sourceRef = useRef("");
  const dirtyRef = useRef(false);
  const leftPaneRef = useRef(null);
  const sashDraggingRef = useRef(false);

  // Render-time refs — loadFile/render effects must not see a stale source.
  activePathRef.current = activePath;
  sourceRef.current = source;
  dirtyRef.current = dirty;

  useEffect(() => {
    const state =
      busy === "list"
        ? "listing"
        : busy === "file"
          ? "loading"
          : busy === "create"
            ? "creating"
            : busy === "save"
              ? "saving"
              : busy === "updating"
                ? "updating"
                : busy === "render"
                  ? "rendering"
                  : dirty
                    ? "dirty"
                    : renderError || fsError
                      ? "error"
                      : via
                        ? "ready"
                        : "idle";
    const detail = renderError || fsError || (state === "ready" ? via : "");
    $flowStatus.set({ state, detail });
  }, [busy, dirty, renderError, fsError, via]);

  useEffect(() => () => $flowStatus.set({ state: "idle", detail: "" }), []);

  // Split size via DOM only — React style would wipe live sash drag on re-render.
  useEffect(() => {
    const el = leftPaneRef.current;
    if (!el) return;
    if (view === "split") {
      if (!sashDraggingRef.current) {
        if (splitOrient === "horizontal") {
          el.style.width = "";
          el.style.height = `${splitPct}%`;
          el.style.maxHeight = "100%";
          el.style.maxWidth = "";
        } else {
          el.style.height = "";
          el.style.maxHeight = "";
          el.style.width = `${splitPct}%`;
          el.style.maxWidth = "100%";
        }
      }
    } else {
      el.style.width = "";
      el.style.height = "";
      el.style.maxWidth = "";
      el.style.maxHeight = "";
    }
  }, [view, splitPct, splitOrient]);

  useEffect(() => {
    storage?.set(STORAGE_VIEW, view);
  }, [view]);

  useEffect(() => {
    storage?.set(STORAGE_SPLIT, splitPct);
  }, [splitPct]);

  useEffect(() => {
    storage?.set(STORAGE_SPLIT_ORIENT, splitOrient);
  }, [splitOrient]);

  // Persist per-project folder + active file (copy-on-write maps)
  useEffect(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {};
    storage?.set(STORAGE_DIRS, { ...map, [projectKey]: relDir });
  }, [projectKey, relDir]);

  useEffect(() => {
    if (!activePath) return;
    const map = storage?.get(STORAGE_ACTIVE, {}) || {};
    storage?.set(STORAGE_ACTIVE, {
      ...map,
      [projectKey]: baseName(activePath),
    });
  }, [projectKey, activePath]);

  // When cwd changes, reload folder config
  useEffect(() => {
    const map = storage?.get(STORAGE_DIRS, {}) || {};
    setRelDir(map[projectKey] || DEFAULT_REL_DIR);
  }, [projectKey]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const path = activePathRef.current;
    const body = sourceRef.current;
    if (!path || !dirtyRef.current) return;
    setFsError("");
    const gen = ++saveGenRef.current;
    setBusy((b) => b || "save");
    try {
      await writeDiagramSnapshot(path, body);
      if (gen !== saveGenRef.current) return;
      if (activePathRef.current !== path || sourceRef.current !== body) return;
      setDirty(false);
      dirtyRef.current = false;
    } catch (err) {
      if (gen === saveGenRef.current) {
        const message = err?.message || "Save failed";
        setFsError(message);
        host.notify({ kind: "error", message });
      }
    } finally {
      if (gen === saveGenRef.current) setBusy((b) => (b === "save" ? "" : b));
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushSave();
    }, 550);
  }, [flushSave]);

  // Unmount / route leave: flush dirty without setState-after-unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // Invalidate in-flight flushSave so it won't setState after unmount.
      saveGenRef.current++;
      if (!dirtyRef.current || !activePathRef.current) return;
      const path = activePathRef.current;
      const body = sourceRef.current;
      void (async () => {
        try {
          await writeDiagramSnapshot(path, body);
          dirtyRef.current = false;
        } catch (err) {
          try {
            host.notify({
              kind: "error",
              message: err?.message || "Save failed",
            });
          } catch {
            /* unmounting */
          }
        }
      })();
    };
  }, []);

  const clearActiveEditor = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveGenRef.current++;
    genRef.current += 1;
    setActivePath("");
    setSource("");
    setSvg("");
    setVia("");
    setRenderError("");
    setDirty(false);
    dirtyRef.current = false;
    try {
      const map = { ...(storage?.get(STORAGE_ACTIVE, {}) || {}) };
      if (map[projectKey]) {
        delete map[projectKey];
        storage?.set(STORAGE_ACTIVE, map);
      }
    } catch {
      /* ok */
    }
  }, [projectKey]);

  const loadFile = useCallback(
    async (path) => {
      if (!path) return;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      setBusy("file");
      setFsError("");
      try {
        const src = await readDiagramForSwitch(path, {
          path: activePathRef.current,
          source: sourceRef.current,
          dirty: dirtyRef.current && !!activePathRef.current,
        });
        // Drop stale preview so SvgCanvas remounts / re-fits for the new file.
        // Bump gen so an in-flight render for the previous source can't land.
        genRef.current += 1;
        setSvg("");
        setVia("");
        setRenderError("");
        setActivePath(path);
        setSource(src);
        setFileLoadId((n) => n + 1);
        setDirty(false);
        dirtyRef.current = false;
      } catch (err) {
        const message = err?.message || String(err);
        setFsError(message);
        host.notify({
          kind: "error",
          message,
        });
      } finally {
        setBusy((b) => (b === "file" ? "" : b));
      }
    },
    [clearActiveEditor],
  );

  // Same active path, disk changed (agent/editor outside) — pull if clean.
  // Skip dirty / pending autosave so local edits win.
  const reloadActiveFromDisk = useCallback(async () => {
    const path = activePathRef.current;
    if (!path || dirtyRef.current || saveTimer.current) return;
    try {
      const text = await fsReadText(path);
      if (activePathRef.current !== path || dirtyRef.current) return;
      const src = extractSource(text, baseName(path));
      if (src === sourceRef.current) return;
      genRef.current += 1;
      setBusy((b) => b || "updating");
      setSource(src);
      setDirty(false);
      dirtyRef.current = false;
      setRenderError("");
    } catch {
      /* missing: refreshList activeGone path */
    }
  }, []);

  const refreshList = useCallback(
    async ({ preferName, autoSelect = true } = {}) => {
      if (!cwd) {
        setFiles([]);
        setFsError("No project cwd — open a project first");
        return;
      }
      setBusy("list");
      setFsError("");
      try {
        const list = await listDiagramFiles(diagramsDir);
        setFiles(list);

        const activeGone =
          !!activePathRef.current &&
          !list.some((f) => f.path === activePathRef.current);

        if (activeGone && (dirtyRef.current || saveTimer.current)) {
          host.notify({
            kind: "error",
            message: "Active diagram changed on disk; local unsaved content was kept",
          });
          return;
        }

        if (!autoSelect) {
          if (activeGone) clearActiveEditor();
          else await reloadActiveFromDisk();
          return;
        }

        const remembered = (storage?.get(STORAGE_ACTIVE, {}) || {})[projectKey];
        const stillThere = list.find((f) => f.path === activePathRef.current);
        const pick =
          (preferName &&
            list.find(
              (f) => f.name === preferName || f.label === preferName,
            )) ||
          stillThere ||
          list.find((f) => f.name === remembered) ||
          list[0];

        if (pick) {
          if (pick.path !== activePathRef.current) await loadFile(pick.path);
          else await reloadActiveFromDisk();
        } else {
          clearActiveEditor();
        }
      } catch (err) {
        setFiles([]);
        setFsError(err?.message || String(err));
      } finally {
        setBusy((b) => (b === "list" ? "" : b));
      }
    },
    [
      cwd,
      diagramsDir,
      projectKey,
      loadFile,
      clearActiveEditor,
      reloadActiveFromDisk,
    ],
  );

  // Load list when dir / cwd changes
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Poll only while mounted; reloadActiveFromDisk preserves dirty/pending autosave edits.
  useEffect(() => {
    const timer = setInterval(() => void reloadActiveFromDisk(), 3000);
    return () => clearInterval(timer);
  }, [reloadActiveFromDisk]);

  // Disk may change outside (agent / other editor / delete) — re-list + reload active if clean.
  useEffect(() => {
    const onFocus = () => void refreshList({ autoSelect: true });
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshList]);

  // Trigger: debounced source (typing) OR activePath (Select) OR fileLoadId (drop/load).
  // Body always from sourceRef — never re-paint the *previous* file's debounced text.
  const debounced = useDebounced(source, 320);
  useEffect(() => {
    const code = sourceRef.current.trim();
    if (!code) {
      setSvg("");
      setVia("");
      setRenderError("");
      return;
    }
    const gen = ++genRef.current;
    const ac = new AbortController();
    setBusy((b) => (b === "file" || b === "list" ? b : "render"));
    setRenderError("");
    renderRemoteSvg(code, isDarkUi(), ac.signal)
      .then((result) => {
        if (gen !== genRef.current) return;
        if (result.kind === "empty") {
          setSvg("");
          setVia("");
          return;
        }
        setSvg(result.svg);
        setVia(result.via || "");
      })
      .catch((err) => {
        if (ac.signal.aborted || gen !== genRef.current) return;
        setRenderError(err?.message || String(err));
      })
      .finally(() => {
        if (gen === genRef.current) setBusy((b) => (b === "render" ? "" : b));
      });
    return () => ac.abort();
  }, [debounced, activePath, fileLoadId]);

  const onSourceChange = (e) => {
    setSource(e.target.value);
    setDirty(true);
    dirtyRef.current = true;
    if (activePath) scheduleSave();
  };

  const createDiagram = async () => {
    const fileName = ensureMmdName(newName);
    if (!cwd) {
      host.notify({ kind: "error", message: "No project cwd" });
      return;
    }
    setBusy("create");
    setFsError("");
    try {
      await createDiagramSnapshot(diagramsDir, fileName, DEFAULT_SOURCE);
      setNewOpen(false);
      setNewName("");
      await refreshList({ preferName: fileName });
      host.notify({ kind: "success", message: `Created ${fileName}` });
    } catch (err) {
      const message = err?.message || "Create failed";
      setFsError(message);
      host.notify({ kind: "error", message });
    } finally {
      setBusy((b) => (b === "create" ? "" : b));
    }
  };

  const applyFolder = async () => {
    const next = folderDraft.trim() || DEFAULT_REL_DIR;
    setRelDir(next);
    setFolderOpen(false);
    host.notify({ kind: "info", message: `Diagrams folder: ${next}` });
  };

  const browseFolder = async () => {
    const b = bridge();
    if (!b) {
      host.notify({ kind: "error", message: "Desktop bridge unavailable" });
      return;
    }
    const picked = await b.selectPaths({
      title: "Mermaid diagrams folder",
      defaultPath: diagramsDir,
      directories: true,
      multiple: false,
    });
    const path = picked?.[0];
    if (!path) return;
    // Prefer project-relative when under cwd
    if (cwd && String(path).startsWith(cwd)) {
      const rel = String(path)
        .slice(cwd.length)
        .replace(/^[/\\]+/, "");
      setFolderDraft(rel || ".");
    } else {
      setFolderDraft(path);
    }
  };

  const revealFolder = async () => {
    try {
      await fsEnsureDir(diagramsDir, { open: true });
    } catch (err) {
      host.notify({ kind: "error", message: err?.message || "Reveal failed" });
    }
  };

  /** Open a path dropped from the files tree (or OS). Mermaid-like only. */
  const openExternalPath = useCallback(
    async (path) => {
      if (!path) return;
      if (!isMermaidPath(path)) {
        host.notify({
          kind: "error",
          message: "Drop a .mmd / .mermaid / .md file",
        });
        return;
      }

      const name = baseName(path);
      const label = name.replace(/\.(mmd|mermaid|md)$/i, "");
      setFiles((prev) => {
        if (prev.some((f) => f.path === path)) return prev;
        return [...prev, { name, path, label }].sort((a, b) =>
          a.label.localeCompare(b.label),
        );
      });
      await loadFile(path);
      host.notify({ kind: "success", message: `Opened ${name}` });
    },
    [loadFile],
  );

  const onDragEnter = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer) && !dragOver) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const onDragOver = (e) => {
    if (!hasHermesFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* ok */
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    const paths = pathsFromDataTransfer(e.dataTransfer);
    const file = paths.find((p) => isMermaidPath(p)) || paths[0];
    if (!file) {
      host.notify({ kind: "error", message: "No file path in drop" });
      return;
    }
    void openExternalPath(file);
  };

  const showEditor = view === "split" || view === "source";
  const showPreview = view === "split" || view === "preview";

  return jsxs("div", {
    className: "relative flex h-full min-h-0 flex-col",
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    children: [
      dragOver
        ? jsx("div", {
            className:
              "pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-(--ui-accent)/10 ring-2 ring-inset ring-(--ui-accent)/50",
            children: jsxs("div", {
              className:
                "rounded-[8px] border border-(--ui-accent)/40 bg-(--ui-bg-tertiary)/95 px-4 py-3 text-sm text-foreground shadow-md backdrop-blur-sm",
              children: [
                jsxs("div", {
                  className: "flex items-center gap-2 font-medium",
                  children: [
                    jsx(Codicon, { name: "file-symlink-file" }),
                    "Drop to open diagram",
                  ],
                }),
                jsx("div", {
                  className: "mt-1 text-[0.75rem] text-(--ui-text-tertiary)",
                  children: ".mmd · .mermaid · .md",
                }),
              ],
            }),
          })
        : null,

      // toolbar — file chrome left, view mode icons right
      jsxs("div", {
        className:
          "flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-secondary)/40 px-3 py-2",
        children: [
          jsxs("div", {
            className: "flex items-center gap-1 min-w-0",
            children: [
              jsxs(Select, {
                value: activePath || undefined,
                onValueChange: (v) => void loadFile(v),
                disabled: !files.length,
                children: [
                  jsx(SelectTrigger, {
                    size: "xs",
                    className: "min-w-40 max-w-56",
                    children: jsx(SelectValue, {
                      placeholder: files.length
                        ? "Select diagram"
                        : "No diagrams",
                    }),
                  }),
                  jsx(SelectContent, {
                    children: files.map((f) =>
                      jsx(
                        SelectItem,
                        { value: f.path, children: f.label },
                        f.path,
                      ),
                    ),
                  }),
                ],
              }),
              jsx(Tip, {
                label: "New diagram",
                children: jsx(Button, {
                  type: "button",
                  size: "icon-xs",
                  variant: "secondary",
                  onClick: () => {
                    haptic("tap");
                    setNewName("");
                    setNewOpen(true);
                  },
                  children: jsx(Codicon, { name: "add" }),
                }),
              }),
              jsx(Tip, {
                label: `Folder: ${relDir}`,
                children: jsx(Button, {
                  type: "button",
                  size: "icon-xs",
                  variant: "ghost",
                  onClick: () => {
                    haptic("tap");
                    setFolderDraft(relDir);
                    setFolderOpen(true);
                  },
                  children: jsx(Codicon, { name: "folder" }),
                }),
              }),
            ],
          }),

          jsx("div", { className: "flex-1" }),

          jsxs("div", {
            className: "flex items-center gap-1",
            children: [
              view === "split"
                ? jsx(SegmentedControl, {
                    value: splitOrient,
                    onChange: (v) =>
                      setSplitOrient(
                        v === "horizontal" ? "horizontal" : "vertical",
                      ),
                    options: [
                      {
                        id: "vertical",
                        label: "",
                        icon: icons.PanelLeftIcon,
                      },
                      {
                        id: "horizontal",
                        label: "",
                        icon: icons.PanelBottom,
                      },
                    ],
                  })
                : jsx(SegmentedControl, {
                    value: view,
                    onChange: () => setView("split"),
                    options: [
                      { id: "split", label: "", icon: icons.LayoutDashboard },
                    ],
                  }),
              jsx(SegmentedControl, {
                value: view,
                onChange: (v) => setView(v),
                options: [
                  { id: "source", label: "", icon: icons.FileText },
                  { id: "preview", label: "", icon: icons.Eye },
                ],
              }),
            ],
          }),
        ],
      }),

      // body
      !cwd
        ? jsx("div", {
            className: "flex flex-1 items-center justify-center p-6",
            children: jsx(EmptyState, {
              title: "No project open",
              description:
                "Open a project so diagrams can live under docs/mermaid.",
            }),
          })
        : jsxs("div", {
            className: cn(
              "relative flex min-h-0 flex-1",
              view === "split"
                ? splitOrient === "horizontal"
                  ? "flex-col"
                  : "flex-row"
                : "flex-col",
            ),
            children: [
              showEditor
                ? jsxs("div", {
                    ref: leftPaneRef,
                    className: cn(
                      "flex min-h-0 min-w-0 flex-col",
                      view === "split" ? "shrink-0" : "flex-1",
                    ),
                    // size via effect + sash refs (not React style — mid-drag re-render wipe)
                    children: [
                      // no SOURCE label / saved chip — editor fills
                      !activePath && !files.length
                        ? jsx("div", {
                            className:
                              "flex flex-1 items-center justify-center p-6",
                            children: jsx(EmptyState, {
                              title: fsError
                                ? "Folder unavailable"
                                : "No diagrams yet",
                              description: fsError
                                ? `${fsError} — create the folder or pick another path.`
                                : `Create one with +  ·  ${relDir}`,
                            }),
                          })
                        : jsx(MermaidEditor, {
                            value: source,
                            onChange: onSourceChange,
                            disabled: !activePath,
                            placeholder: "flowchart TD\n  A --> B",
                          }),
                      renderError
                        ? jsx("div", {
                            className:
                              "border-t border-(--ui-stroke-secondary)/40 px-3 py-2 text-[0.75rem] text-destructive whitespace-pre-wrap",
                            children: renderError,
                          })
                        : null,
                    ],
                  })
                : null,

              view === "split"
                ? jsx(SplitSash, {
                    orientation: splitOrient,
                    onLivePct: (pct) => {
                      sashDraggingRef.current = true;
                      const el = leftPaneRef.current;
                      if (!el) return;
                      if (splitOrient === "horizontal") {
                        el.style.height = `${pct}%`;
                      } else {
                        el.style.width = `${pct}%`;
                      }
                    },
                    onCommitPct: (pct) => {
                      sashDraggingRef.current = false;
                      setSplitPct(pct);
                    },
                    onReset: () => {
                      sashDraggingRef.current = false;
                      const el = leftPaneRef.current;
                      if (el) {
                        if (splitOrient === "horizontal")
                          el.style.height = "50%";
                        else el.style.width = "50%";
                      }
                      setSplitPct(50);
                    },
                  })
                : null,

              showPreview
                ? jsxs("div", {
                    className: cn(
                      "relative flex min-h-0 min-w-0 flex-col",
                      view === "split" ? "min-h-0 min-w-0 flex-1" : "flex-1",
                    ),
                    children: [
                      !source.trim()
                        ? jsx("div", {
                            className:
                              "flex flex-1 items-center justify-center p-6",
                            children: jsx(EmptyState, {
                              title: "Empty diagram",
                              description:
                                "Write Mermaid source — preview updates live.",
                            }),
                          })
                        : svg
                          ? jsx(SvgCanvas, {
                              svg,
                              // path + view + orient + split%: layout/sash commit re-fits once
                              fitKey: `${activePath || "draft"}|${view}|${splitOrient}|${splitPct}`,
                            })
                          : jsx("div", {
                              className: "relative min-h-0 flex-1",
                            }),
                    ],
                  })
                : null,
            ],
          }),

      // New diagram dialog
      jsxs(Dialog, {
        open: newOpen,
        onOpenChange: setNewOpen,
        children: [
          jsxs(DialogContent, {
            className: "min-w-80",
            children: [
              jsxs(DialogHeader, {
                children: [
                  jsx(DialogTitle, { children: "New diagram" }),
                  jsx(DialogDescription, {
                    children: `Saved as .mmd under ${relDir}`,
                  }),
                ],
              }),
              jsx(Input, {
                autoFocus: true,
                placeholder: "photo-happy-path",
                value: newName,
                onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createDiagram();
                  }
                },
              }),
              jsxs(DialogFooter, {
                children: [
                  jsx(Button, {
                    type: "button",
                    variant: "ghost",
                    size: "sm",
                    onClick: () => setNewOpen(false),
                    children: "Cancel",
                  }),
                  jsx(Button, {
                    type: "button",
                    size: "sm",
                    disabled: !newName.trim() || busy === "create",
                    onClick: () => void createDiagram(),
                    children: busy === "create" ? "Creating…" : "Create",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),

      // Folder settings dialog
      jsxs(Dialog, {
        open: folderOpen,
        onOpenChange: setFolderOpen,
        children: [
          jsxs(DialogContent, {
            className: "min-w-96",
            children: [
              jsxs(DialogHeader, {
                children: [
                  jsx(DialogTitle, { children: "Diagrams folder" }),
                  jsx(DialogDescription, {
                    children:
                      "Per-project path. Relative paths resolve from the workspace cwd. Absolute paths are used as-is.",
                  }),
                ],
              }),
              jsxs("div", {
                className: "flex items-center gap-2",
                children: [
                  jsx(Input, {
                    value: folderDraft,
                    onChange: (e) => setFolderDraft(e.target.value),
                    placeholder: DEFAULT_REL_DIR,
                    className: "flex-1 font-mono text-xs",
                  }),
                  jsx(Button, {
                    type: "button",
                    size: "sm",
                    variant: "secondary",
                    onClick: () => void browseFolder(),
                    children: "Browse",
                  }),
                ],
              }),
              jsx("div", {
                className:
                  "text-[0.6875rem] text-(--ui-text-quaternary) font-mono break-all",
                children: `→ ${resolveDiagramsDir(cwd, folderDraft.trim() || DEFAULT_REL_DIR)}`,
              }),
              jsxs(DialogFooter, {
                children: [
                  jsx(Button, {
                    type: "button",
                    variant: "ghost",
                    size: "sm",
                    onClick: () => void revealFolder(),
                    children: "Reveal",
                  }),
                  jsx(Button, {
                    type: "button",
                    variant: "ghost",
                    size: "sm",
                    onClick: () => {
                      setFolderDraft(DEFAULT_REL_DIR);
                    },
                    children: "Reset default",
                  }),
                  jsx(Button, {
                    type: "button",
                    size: "sm",
                    onClick: () => void applyFolder(),
                    children: "Apply",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
