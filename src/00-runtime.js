import {
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
  STATUSBAR_AREAS,
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

/** @type {{ get: Function, set: Function, remove: Function } | null} */
let storage = null;
