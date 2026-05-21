import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { OutputDetailLevel } from "@/feedback/output-detail";
import type { DockPosition, LensTheme, PopupState, ResolvedHover } from "@/types";

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
  theme?: unknown;
};

type LensSettings = {
  outputDetail: OutputDetailLevel;
  theme: LensTheme | null;
};

function isLensTheme(value: unknown): value is LensTheme {
  return value === "dark" || value === "light";
}

function readStoredSettings(storageKey: string): LensSettings {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { outputDetail: "standard", theme: null };
    const parsed = JSON.parse(raw) as StoredLensSettings;
    return {
      outputDetail: isOutputDetailLevel(parsed.outputDetail) ? parsed.outputDetail : "standard",
      theme: isLensTheme(parsed.theme) ? parsed.theme : null,
    };
  } catch {
    return { outputDetail: "standard", theme: null };
  }
}

function writeStoredSettings(storageKey: string, settings: LensSettings): void {
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
  inventoryOpen: boolean;
  settingsOpen: boolean;
  markersVisible: boolean;
  outputDetail: OutputDetailLevel;
  theme: LensTheme | null;
  dockPosition: DockPosition | null;
  hover: ResolvedHover | null;
  selectedHover: ResolvedHover | null;
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
  toggleInventory: () => void;
  setInventoryOpen: (inventoryOpen: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (settingsOpen: boolean) => void;
  toggleMarkersVisible: () => void;
  setMarkersVisible: (markersVisible: boolean) => void;
  setOutputDetail: (outputDetail: OutputDetailLevel) => void;
  setTheme: (theme: LensTheme) => void;
  startCapture: () => void;
  stopCapture: () => void;
  setDragging: (dragging: boolean) => void;
  setDockPosition: (position: DockPosition, options?: { persist?: boolean }) => void;
  resetDockPosition: () => void;
  setHover: (hover: ResolvedHover | null) => void;
  setSelectedHover: (selectedHover: ResolvedHover | null) => void;
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
};

const DEFAULT_POPUP_DRAFT: PopupDraft = {
  comment: "",
};

function defaultPopupDraft(): PopupDraft {
  return { ...DEFAULT_POPUP_DRAFT };
}

export type LensUiStore = StoreApi<LensUiState>;

export function createLensUiStore(
  storageKey = POSITION_STORAGE_KEY,
  settingsStorageKey = SETTINGS_STORAGE_KEY,
): LensUiStore {
  const initialSettings = readStoredSettings(settingsStorageKey);
  return createStore<LensUiState>((set) => ({
    open: false,
    armed: false,
    dragging: false,
    inventoryOpen: false,
    settingsOpen: false,
    markersVisible: true,
    outputDetail: initialSettings.outputDetail,
    theme: initialSettings.theme,
    dockPosition: readStoredPosition(storageKey),
    hover: null,
    selectedHover: null,
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
          ? {
              armed: false,
              hover: null,
              inventoryOpen: false,
              open: false,
              popup: null,
              selectedHover: null,
              settingsOpen: false,
            }
          : { open: true },
      ),
    toggleInventory: () =>
      set((state) => ({
        armed: false,
        hover: null,
        inventoryOpen: !state.inventoryOpen,
        open: true,
        popup: null,
        settingsOpen: false,
      })),
    setInventoryOpen: (inventoryOpen) =>
      set({ armed: false, hover: null, inventoryOpen, popup: null }),
    toggleSettings: () =>
      set((state) => ({
        armed: false,
        hover: null,
        inventoryOpen: false,
        open: true,
        popup: null,
        settingsOpen: !state.settingsOpen,
      })),
    setSettingsOpen: (settingsOpen) =>
      set((state) => ({
        armed: false,
        hover: null,
        inventoryOpen: settingsOpen ? false : state.inventoryOpen,
        popup: null,
        settingsOpen,
      })),
    toggleMarkersVisible: () => set((state) => ({ markersVisible: !state.markersVisible })),
    setMarkersVisible: (markersVisible) => set({ markersVisible }),
    setOutputDetail: (outputDetail) =>
      set((state) => {
        writeStoredSettings(settingsStorageKey, { outputDetail, theme: state.theme });
        return { outputDetail };
      }),
    setTheme: (theme) =>
      set((state) => {
        writeStoredSettings(settingsStorageKey, { outputDetail: state.outputDetail, theme });
        return { theme };
      }),
    startCapture: () =>
      set({ armed: true, hover: null, inventoryOpen: false, popup: null, settingsOpen: false }),
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
    setSelectedHover: (selectedHover) => set({ hover: null, selectedHover }),
    setPopup: (popup) =>
      set((state) => ({
        popup,
        popupDraft: defaultPopupDraft(),
        selectedHover: popup?.hover ?? state.selectedHover,
      })),
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
    resetInteraction: () =>
      set({ armed: false, hover: null, inventoryOpen: false, popup: null, settingsOpen: false }),
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
