import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DockPosition, PopupState, ResolvedHover } from "@/types";

const POSITION_STORAGE_KEY = "marimo-lens:dock-position";

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

type LensUiState = {
  open: boolean;
  armed: boolean;
  dragging: boolean;
  dockPosition: DockPosition | null;
  hover: ResolvedHover | null;
  popup: PopupState | null;
  copied: boolean;
  toggleOpen: () => void;
  startCapture: () => void;
  stopCapture: () => void;
  setDragging: (dragging: boolean) => void;
  setDockPosition: (position: DockPosition, options?: { persist?: boolean }) => void;
  resetDockPosition: () => void;
  setHover: (hover: ResolvedHover | null) => void;
  setPopup: (popup: PopupState | null) => void;
  setCopied: (copied: boolean) => void;
  resetInteraction: () => void;
};

export type LensUiStore = StoreApi<LensUiState>;

export function createLensUiStore(storageKey = POSITION_STORAGE_KEY): LensUiStore {
  return createStore<LensUiState>((set) => ({
    open: true,
    armed: false,
    dragging: false,
    dockPosition: readStoredPosition(storageKey),
    hover: null,
    popup: null,
    copied: false,
    toggleOpen: () =>
      set((state) => (state.open ? { hover: null, open: false, popup: null } : { open: true })),
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
    setPopup: (popup) => set({ popup }),
    setCopied: (copied) => set({ copied }),
    resetInteraction: () => set({ armed: false, hover: null, popup: null }),
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
