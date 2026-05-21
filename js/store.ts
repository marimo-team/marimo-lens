import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { OutputDetailLevel } from "@/feedback/output-detail";
import type { DockPosition, LensAnnotation, PopupState, ResolvedHover } from "@/types";

import { isOutputDetailLevel } from "@/feedback/output-detail";

const POSITION_STORAGE_KEY = "marimo-lens:toolbar-position:v3";
const SETTINGS_STORAGE_KEY = "marimo-lens:settings:v1";

function readStoredPosition(storageKey: string): DockPosition | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DockPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function writeStoredPosition(storageKey: string, position: DockPosition | null): void {
  try {
    if (position) {
      window.localStorage.setItem(storageKey, JSON.stringify(position));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable in embedded or privacy-restricted contexts.
  }
}

function samePosition(a: DockPosition | null, b: DockPosition | null): boolean {
  return a?.x === b?.x && a?.y === b?.y;
}

type StoredLensSettings = {
  outputDetail?: unknown;
};

function readStoredSettings(storageKey: string): { outputDetail: OutputDetailLevel } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { outputDetail: "standard" };
    const parsed = JSON.parse(raw) as StoredLensSettings;
    return {
      outputDetail: isOutputDetailLevel(parsed.outputDetail) ? parsed.outputDetail : "standard",
    };
  } catch {
    return { outputDetail: "standard" };
  }
}

function writeStoredSettings(
  storageKey: string,
  settings: { outputDetail: OutputDetailLevel },
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in embedded or privacy-restricted contexts.
  }
}

type LensUiState = {
  open: boolean;
  armed: boolean;
  dragging: boolean;
  settingsOpen: boolean;
  outputDetail: OutputDetailLevel;
  dockPosition: DockPosition | null;
  hover: ResolvedHover | null;
  popup: PopupState | null;
  popupDraft: PopupDraft;
  copied: boolean;
  copyStatus: "idle" | "pending" | "success" | "error";
  copyRequestId: string | null;
  copyStartedRevision: number | null;
  copiedRevision: number | null;
  copyError: string;
  dismissedAgentMessageIds: string[];
  toggleOpen: () => void;
  toggleSettings: () => void;
  setSettingsOpen: (settingsOpen: boolean) => void;
  setOutputDetail: (outputDetail: OutputDetailLevel) => void;
  startCapture: () => void;
  stopCapture: () => void;
  setDragging: (dragging: boolean) => void;
  setDockPosition: (position: DockPosition, options?: { persist?: boolean }) => void;
  resetDockPosition: () => void;
  setHover: (hover: ResolvedHover | null) => void;
  setPopup: (popup: PopupState | null) => void;
  updatePopupDraft: (draft: Partial<PopupDraft>) => void;
  resetPopupDraft: () => void;
  setCopied: (copied: boolean) => void;
  startCopy: (requestId: string, contextRevision: number) => void;
  copySucceeded: (revision: number) => void;
  copyFailed: (error: string) => void;
  resetCopyStatus: (copiedRevision?: number) => void;
  dismissAgentMessage: (messageId: string) => void;
  resetInteraction: () => void;
};

type PopupDraft = {
  comment: string;
  intent: LensAnnotation["intent"];
  severity: LensAnnotation["severity"];
};

const DEFAULT_POPUP_DRAFT: PopupDraft = {
  comment: "",
  intent: "fix",
  severity: "important",
};

function defaultPopupDraft(): PopupDraft {
  return { ...DEFAULT_POPUP_DRAFT };
}

export type LensUiStore = StoreApi<LensUiState>;

export function createLensUiStore(storageKey = POSITION_STORAGE_KEY): LensUiStore {
  const initialSettings = readStoredSettings(SETTINGS_STORAGE_KEY);
  return createStore<LensUiState>((set) => ({
    open: false,
    armed: false,
    dragging: false,
    settingsOpen: false,
    outputDetail: initialSettings.outputDetail,
    dockPosition: readStoredPosition(storageKey),
    hover: null,
    popup: null,
    popupDraft: defaultPopupDraft(),
    copied: false,
    copyStatus: "idle",
    copyRequestId: null,
    copyStartedRevision: null,
    copiedRevision: null,
    copyError: "",
    dismissedAgentMessageIds: [],
    toggleOpen: () =>
      set((state) =>
        state.open
          ? { hover: null, open: false, popup: null, settingsOpen: false }
          : { open: true },
      ),
    toggleSettings: () =>
      set((state) => ({
        armed: false,
        hover: null,
        open: true,
        popup: null,
        settingsOpen: !state.settingsOpen,
      })),
    setSettingsOpen: (settingsOpen) =>
      set({ armed: false, hover: null, popup: null, settingsOpen }),
    setOutputDetail: (outputDetail) => {
      writeStoredSettings(SETTINGS_STORAGE_KEY, { outputDetail });
      set({ outputDetail });
    },
    startCapture: () => set({ armed: true, popup: null, hover: null }),
    stopCapture: () => set({ armed: false, hover: null }),
    setDragging: (dragging) => set({ dragging }),
    setDockPosition: (dockPosition, options) =>
      set((state) => {
        if (options?.persist !== false) {
          writeStoredPosition(storageKey, dockPosition);
        }
        if (samePosition(state.dockPosition, dockPosition)) return state;
        return { dockPosition };
      }),
    resetDockPosition: () => {
      writeStoredPosition(storageKey, null);
      set({ dockPosition: null, dragging: false });
    },
    setHover: (hover) => set({ hover }),
    setPopup: (popup) => set({ popup, popupDraft: defaultPopupDraft() }),
    updatePopupDraft: (popupDraft) =>
      set((state) => ({ popupDraft: { ...state.popupDraft, ...popupDraft } })),
    resetPopupDraft: () => set({ popupDraft: defaultPopupDraft() }),
    setCopied: (copied) => set({ copied }),
    startCopy: (copyRequestId, copyStartedRevision) =>
      set({
        copied: false,
        copyError: "",
        copyRequestId,
        copyStartedRevision,
        copiedRevision: null,
        copyStatus: "pending",
      }),
    copySucceeded: (copiedRevision) =>
      set({
        copied: true,
        copiedRevision,
        copyError: "",
        copyRequestId: null,
        copyStartedRevision: null,
        copyStatus: "success",
      }),
    copyFailed: (copyError) =>
      set({
        copied: false,
        copyError,
        copyRequestId: null,
        copyStartedRevision: null,
        copyStatus: "error",
      }),
    resetCopyStatus: (expectedRevision) =>
      set((state) => {
        if (state.copyStatus !== "success") return state;
        if (expectedRevision !== undefined && state.copiedRevision !== expectedRevision) {
          return state;
        }
        return { copied: false, copyStatus: "idle" };
      }),
    dismissAgentMessage: (messageId) =>
      set((state) =>
        state.dismissedAgentMessageIds.includes(messageId)
          ? state
          : { dismissedAgentMessageIds: [...state.dismissedAgentMessageIds, messageId] },
      ),
    resetInteraction: () => set({ armed: false, hover: null, popup: null, settingsOpen: false }),
  }));
}

const LensUiStoreContext = createContext<LensUiStore | null>(null);

export function LensUiStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<LensUiStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createLensUiStore();
  }

  return createElement(LensUiStoreContext.Provider, { value: storeRef.current }, children);
}

export function useLensUiStore<T>(selector: (state: LensUiState) => T): T {
  const store = useContext(LensUiStoreContext);
  if (!store) {
    throw new Error("useLensUiStore must be used inside LensUiStoreProvider");
  }
  return useStore(store, selector);
}
