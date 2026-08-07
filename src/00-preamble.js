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
  icons,
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
  atom,
} from "@hermes/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.12;
const DEFAULT_REL_DIR = "docs/mermaid";
const DEFAULT_SOURCE = `flowchart TD
  A[Start] --> B[Next]
`;

/** Live zoom actions published by SvgCanvas → PREVIEW header. */
const $previewChrome = atom(null);

const STORAGE_VIEW = "view";
const STORAGE_SPLIT = "splitPct"; // 0..100 left pane share
const STORAGE_DIRS = "projectDirs"; // { [cwd]: relativeOrAbsolute }
const STORAGE_ACTIVE = "projectActive"; // { [cwd]: fileName }

// ---------------------------------------------------------------------------
// Plugin-scoped handles (set in register)
// ---------------------------------------------------------------------------

/** @type {{ get: Function, set: Function, remove: Function } | null} */
let storage = null;
/** @type {{ openExternal: Function, writeClipboard: Function, revealPath: Function } | null} */
let os = null;

// ---------------------------------------------------------------------------
// Path + desktop FS helpers
// ---------------------------------------------------------------------------

