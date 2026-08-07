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

  const genRef = useRef(0);
  const saveTimer = useRef(null);
  const saveGenRef = useRef(0);
  const activePathRef = useRef("");
  const sourceRef = useRef("");
  const dirtyRef = useRef(false);
  const leftPaneRef = useRef(null);
  const sashDraggingRef = useRef(false);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Split width via DOM only — React style.width would wipe live sash drag on re-render.
  useEffect(() => {
    const el = leftPaneRef.current;
    if (!el) return;
    if (view === "split") {
      if (!sashDraggingRef.current) el.style.width = `${splitPct}%`;
      el.style.maxWidth = "100%";
    } else {
      el.style.width = "";
      el.style.maxWidth = "";
    }
  }, [view, splitPct]);

  useEffect(() => {
    storage?.set(STORAGE_VIEW, view);
  }, [view]);

  useEffect(() => {
    storage?.set(STORAGE_SPLIT, splitPct);
  }, [splitPct]);

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

  const writeActiveIfDirty = useCallback(async () => {
    const path = activePathRef.current;
    const body = sourceRef.current;
    if (!path || !dirtyRef.current) return false;
    const packed = packSource(body, baseName(path));
    try {
      await fsWriteText(path, packed);
    } catch (err) {
      const msg = err?.message || String(err);
      if (/parent directory does not exist|ENOENT|not exist/i.test(msg)) {
        const dir = path.replace(/[/\\][^/\\]+$/, "");
        await fsEnsureDir(dir, { open: false });
        await fsWriteText(path, packed);
      } else {
        throw err;
      }
    }
    return true;
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const path = activePathRef.current;
    const body = sourceRef.current;
    if (!path || !dirtyRef.current) return;
    const gen = ++saveGenRef.current;
    setBusy((b) => b || "save");
    try {
      await writeActiveIfDirty();
      if (gen !== saveGenRef.current) return;
      if (activePathRef.current !== path || sourceRef.current !== body) return;
      setDirty(false);
      dirtyRef.current = false;
    } catch (err) {
      if (gen === saveGenRef.current) {
        host.notify({ kind: "error", message: err?.message || "Save failed" });
      }
    } finally {
      if (gen === saveGenRef.current) setBusy((b) => (b === "save" ? "" : b));
    }
  }, [writeActiveIfDirty]);

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
      const packed = packSource(body, baseName(path));
      void (async () => {
        try {
          await fsWriteText(path, packed);
          dirtyRef.current = false;
        } catch (err) {
          try {
            const msg = err?.message || String(err);
            if (/parent directory does not exist|ENOENT|not exist/i.test(msg)) {
              const dir = path.replace(/[/\\][^/\\]+$/, "");
              await fsEnsureDir(dir, { open: false });
              await fsWriteText(path, packed);
              dirtyRef.current = false;
              return;
            }
          } catch {
            /* fall through */
          }
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

  const loadFile = useCallback(async (path) => {
    if (!path) return;
    // save previous first
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (
      dirtyRef.current &&
      activePathRef.current &&
      activePathRef.current !== path
    ) {
      try {
        await fsWriteText(
          activePathRef.current,
          packSource(sourceRef.current, baseName(activePathRef.current)),
        );
        setDirty(false);
        dirtyRef.current = false;
      } catch {
        /* keep going */
      }
    }

    setBusy("file");
    setFsError("");
    try {
      const text = await fsReadText(path);
      const src = extractSource(text, baseName(path));
      setActivePath(path);
      setSource(src);
      setDirty(false);
      dirtyRef.current = false;
    } catch (err) {
      setFsError(err?.message || String(err));
      host.notify({ kind: "error", message: err?.message || "Read failed" });
    } finally {
      setBusy((b) => (b === "file" ? "" : b));
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

        if (!autoSelect) return;

        const remembered = (storage?.get(STORAGE_ACTIVE, {}) || {})[projectKey];
        const pick =
          (preferName &&
            list.find(
              (f) => f.name === preferName || f.label === preferName,
            )) ||
          list.find((f) => f.name === remembered) ||
          list.find((f) => f.path === activePathRef.current) ||
          list[0];

        if (pick) {
          if (pick.path !== activePathRef.current) await loadFile(pick.path);
        } else {
          setActivePath("");
          setSource("");
          setSvg("");
          setDirty(false);
        }
      } catch (err) {
        setFiles([]);
        setFsError(err?.message || String(err));
      } finally {
        setBusy((b) => (b === "list" ? "" : b));
      }
    },
    [cwd, diagramsDir, projectKey, loadFile],
  );

  // Load list when dir / cwd changes
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Render preview
  const debounced = useDebounced(source, 320);
  useEffect(() => {
    const code = debounced.trim();
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
  }, [debounced]);

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
    try {
      await fsEnsureDir(diagramsDir, { open: false });
      const path = joinPath(diagramsDir, fileName);
      try {
        await fsReadText(path);
        host.notify({ kind: "error", message: `${fileName} already exists` });
        return;
      } catch {
        /* new file ok */
      }
      await fsWriteText(path, DEFAULT_SOURCE);
      setNewOpen(false);
      setNewName("");
      await refreshList({ preferName: fileName });
      host.notify({ kind: "success", message: `Created ${fileName}` });
    } catch (err) {
      host.notify({ kind: "error", message: err?.message || "Create failed" });
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
    if (!b?.selectPaths) {
      host.notify({ kind: "error", message: "Folder picker unavailable" });
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

  const copySource = async () => {
    const ok = os ? await os.writeClipboard(source) : false;
    host.notify({
      kind: ok ? "success" : "error",
      message: ok ? "Source copied" : "Clipboard unavailable",
    });
  };

  const copySvg = async () => {
    if (!svg) return;
    const ok = os ? await os.writeClipboard(svg) : false;
    host.notify({
      kind: ok ? "success" : "error",
      message: ok ? "SVG copied" : "Clipboard unavailable",
    });
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

  const statusBadge = useMemo(() => {
    if (busy === "save")
      return jsx(Badge, { variant: "muted", children: "saving" });
    if (dirty) return jsx(Badge, { variant: "warn", children: "dirty" });
    if (renderError)
      return jsx(Badge, { variant: "destructive", children: "error" });
    if (via) return jsx(Badge, { variant: "default", children: via });
    return jsx(Badge, { variant: "outline", children: "idle" });
  }, [busy, dirty, renderError, via]);

  const showEditor = view === "split" || view === "source";
  const showPreview = view === "split" || view === "preview";
  const activeFile = files.find((f) => f.path === activePath);
  const spinnerShow =
    busy === "list" ||
    busy === "file" ||
    busy === "render" ||
    busy === "create";
  const spinnerLabel =
    busy === "list"
      ? "Listing…"
      : busy === "file"
        ? "Loading…"
        : busy === "create"
          ? "Creating…"
          : busy === "render"
            ? "Rendering…"
            : "";

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

      // toolbar
      jsxs("div", {
        className:
          "flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-secondary)/40 px-3 py-2",
        children: [
          jsxs("div", {
            className: "flex items-center gap-2 min-w-0",
            children: [
              jsx(Codicon, {
                name: "type-hierarchy-sub",
                className: "text-(--ui-text-tertiary)",
              }),
              jsx("div", {
                className: "text-sm font-medium shrink-0",
                children: "Mermaid Flow",
              }),
              statusBadge,
            ],
          }),

          // diagram selector + create
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
              jsx(ToolbarButton, {
                tip: "New diagram",
                variant: "secondary",
                onClick: () => {
                  setNewName("");
                  setNewOpen(true);
                },
                children: jsx(Codicon, { name: "add" }),
              }),
              jsx(ToolbarButton, {
                tip: "Reload folder",
                onClick: () => void refreshList(),
                children: jsx(Codicon, { name: "refresh" }),
              }),
              jsx(ToolbarButton, {
                tip: `Folder: ${relDir}`,
                onClick: () => {
                  setFolderDraft(relDir);
                  setFolderOpen(true);
                },
                children: jsx(Codicon, { name: "folder" }),
              }),
            ],
          }),

          jsx("div", {
            className:
              "text-[0.6875rem] text-(--ui-text-quaternary) truncate max-w-[28%]",
            children: activeFile ? activeFile.name : relDir,
          }),

          jsx("div", { className: "flex-1" }),

          jsx(SegmentedControl, {
            value: view,
            onChange: (v) => setView(v),
            options: [
              { id: "split", label: "Split" },
              { id: "source", label: "Source" },
              { id: "preview", label: "Preview" },
            ],
          }),

          jsxs("div", {
            className: "flex items-center gap-1",
            children: [
              jsx(ToolbarButton, {
                tip: "Save now",
                disabled: !dirty || !activePath,
                onClick: () => void flushSave(),
                children: jsx(Codicon, { name: "save" }),
              }),
              jsx(ToolbarButton, {
                tip: "Copy source",
                onClick: copySource,
                children: jsx(Codicon, { name: "copy" }),
              }),
              jsx(ToolbarButton, {
                tip: "Copy SVG",
                disabled: !svg,
                onClick: copySvg,
                children: "SVG",
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
              view === "split" ? "flex-row" : "flex-col",
            ),
            children: [
              showEditor
                ? jsxs("div", {
                    ref: leftPaneRef,
                    className: cn(
                      "flex min-h-0 min-w-0 flex-col",
                      view === "split" ? "shrink-0" : "flex-1",
                    ),
                    // width via effect + sash refs (not React style — mid-drag re-render wipe)
                    children: [
                      jsx(PaneHeader, {
                        title: "source",
                        right: jsx(SourceChrome, {
                          dirty,
                          disabled: !activePath,
                          onSave: () => void flushSave(),
                        }),
                      }),
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

              view === "split" && showEditor && showPreview
                ? jsx(SplitSash, {
                    onLivePct: (pct) => {
                      sashDraggingRef.current = true;
                      const el = leftPaneRef.current;
                      if (el) el.style.width = `${pct}%`;
                    },
                    onCommitPct: (pct) => {
                      sashDraggingRef.current = false;
                      setSplitPct(pct);
                    },
                    onReset: () => {
                      sashDraggingRef.current = false;
                      const el = leftPaneRef.current;
                      if (el) el.style.width = "50%";
                      setSplitPct(50);
                    },
                  })
                : null,

              showPreview
                ? jsxs("div", {
                    className: cn(
                      "relative flex min-h-0 min-w-0 flex-col",
                      view === "split" ? "min-w-0 flex-1" : "flex-1",
                    ),
                    children: [
                      jsx(PaneHeader, {
                        title: "preview",
                        right: jsx(PreviewChrome, {}),
                      }),
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
                              fitKey: activePath || "draft",
                            })
                          : jsx("div", {
                              className: "relative min-h-0 flex-1",
                            }),
                      jsx(CornerSpinner, {
                        show: spinnerShow,
                        label: spinnerLabel,
                      }),
                    ],
                  })
                : null,
            ],
          }),

      jsx("div", {
        className:
          "flex items-center gap-2 border-t border-(--ui-stroke-secondary)/40 px-3 py-1.5 text-[0.6875rem] text-(--ui-text-quaternary)",
        children: `${diagramsDir}  ·  drag pan · wheel zoom · autosave .mmd`,
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

// ---------------------------------------------------------------------------
// Plugin contract
// ---------------------------------------------------------------------------

export default {
  id: "mermaid-flow",
  name: "Mermaid Flow",
  defaultEnabled: true,
  register(ctx) {
    storage = ctx.storage;
    os = ctx.os;

    const open = () => host.navigate("/mermaid-flow");

    ctx.registerMany([
      {
        id: "page",
        area: ROUTES_AREA,
        data: { path: "/mermaid-flow" },
        render: () => jsx(FlowPage, {}),
      },
      {
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        data: {
          path: "/mermaid-flow",
          label: "Mermaid Flow",
          codicon: "type-hierarchy-sub",
        },
      },
      {
        id: "open",
        area: PALETTE_AREA,
        data: {
          id: "mermaid-flow.open",
          action: "mermaid-flow.open",
          label: "Open Mermaid Flow",
          keywords: ["mermaid", "diagram", "flow", "docs"],
          run: open,
        },
      },
      {
        id: "open-key",
        area: KEYBINDS_AREA,
        data: {
          id: "mermaid-flow.open",
          label: "Open Mermaid Flow",
          category: "Mermaid Flow",
          defaults: ["mod+shift+m"],
          run: open,
        },
      },
    ]);
  },
};
