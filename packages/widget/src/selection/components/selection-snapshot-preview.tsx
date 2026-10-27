import type { Selection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { AlertCircle, Clock3, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

import type {
  SelectionSnapshotLease,
  SelectionSnapshotLoader,
} from "@/selection/selection-snapshot-loader";

import { errorMessage } from "@/anywidget/error";
import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { iconButtonStyles, ui } from "@/styles/primitives";
import { useAnchoredSurface, type AnchoredSurfaceAnchor } from "@/ui/anchored-surface";

import { SnapshotPreviewDialog, type LoadedSnapshot } from "./selection-snapshot-dialog";
import { snapshotStyles } from "./selection-snapshot-preview.styles";

type SnapshotPreviewButtonProps = {
  selection: Selection;
  capturing: boolean;
  variant?: "icon" | "label";
  snapshotLoader: SelectionSnapshotLoader;
};

type SnapshotAssetController = {
  current: LoadedSnapshot | null;
  loading: boolean;
  error: string | null;
  ensureLoaded: () => Promise<void>;
  release: () => void;
};

export function SnapshotPreviewButton({
  selection,
  capturing,
  variant = "label",
  snapshotLoader,
}: SnapshotPreviewButtonProps) {
  const dom = useNotebookDom();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDialogElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const timerWindow = useRef<Window | null>(null);
  const suppressFocusOpen = useRef(false);
  const openSnapshotKey = useRef("");
  const [open, setOpen] = useState(false);
  const [anchorElement, setAnchorElement] = useState<HTMLButtonElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const [motion, setMotion] = useState<"animate" | "instant">("animate");
  const snapshot = selection.snapshot;
  const stored = snapshot.status === "available" || snapshot.status === "outdated";
  const snapshotKey = stored ? `${selection.id}:${snapshot.sha256}` : "";
  const { current, loading, error, ensureLoaded, release } = useSnapshotAsset({
    selectionId: selection.id,
    snapshotKey,
    sha256: stored ? snapshot.sha256 : "",
    stored,
    snapshotLoader,
    triggerRef,
  });
  const anchor = elementAnchor(anchorElement);
  const position = useAnchoredSurface({
    anchor,
    open,
    preferredPlacement: anchor && anchor.rect.top < 300 ? "below" : "above",
    gap: 8,
    width: 336,
    surfaceRef,
    fallback: { inset: { left: 12, bottom: 64 }, placement: "above" },
  });

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) timerWindow.current?.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) timerWindow.current?.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
    timerWindow.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    openSnapshotKey.current = "";
    release();
    setOpen(false);
    setPinned(false);
  }, [clearTimers, release]);
  const closeFromOutside = useEffectEvent(close);
  const closeAndRestoreFocus = useCallback(() => {
    close();
    const trigger = triggerRef.current;
    if (!trigger || dom.activeElement === trigger) return;
    suppressFocusOpen.current = true;
    trigger.focus({ preventScroll: true });
  }, [close, dom]);

  const show = useCallback(
    (nextMotion: "animate" | "instant") => {
      clearTimers();
      setMotion(nextMotion);
      setAnchorElement(triggerRef.current);
      setOpen(true);
      openSnapshotKey.current = snapshotKey;
      void ensureLoaded();
    },
    [clearTimers, ensureLoaded, snapshotKey],
  );

  const scheduleOpen = useCallback(() => {
    clearTimers();
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    timerWindow.current = ownerWindow;
    openTimer.current = ownerWindow.setTimeout(() => show("animate"), 180);
  }, [clearTimers, show]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    if (pinned) return;
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    timerWindow.current = ownerWindow;
    closeTimer.current = ownerWindow.setTimeout(close, 120);
  }, [clearTimers, close, pinned]);

  useEffect(() => {
    if (!open || openSnapshotKey.current === snapshotKey) return;
    openSnapshotKey.current = snapshotKey;
    void ensureLoaded();
  }, [ensureLoaded, open, snapshotKey]);

  useEffect(() => {
    if (!pinned) return undefined;
    const ownerDocument = wrapperRef.current?.ownerDocument;
    if (!ownerDocument) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!event.composedPath().includes(wrapperRef.current!)) {
        closeFromOutside();
      }
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    return () => ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
  }, [pinned]);

  useEffect(
    () => () => {
      clearTimers();
    },
    [clearTimers],
  );

  if (!stored) {
    const pending = capturing || snapshot.status === "pending";
    return (
      <output
        {...stylex.props(
          snapshotStyles.trigger,
          variant === "icon" && snapshotStyles.triggerIcon,
          !pending && snapshotStyles.triggerFailed,
        )}
        data-marimo-lens-snapshot-trigger
        data-status={pending ? "capturing" : "failed"}
        title={pending ? "Preparing image" : "Image unavailable"}
        aria-label={pending ? "Preparing image" : "Image unavailable"}
      >
        {pending ? (
          <LoaderCircle {...stylex.props(ui.spin)} size={13} aria-hidden="true" />
        ) : (
          <AlertCircle size={13} aria-hidden="true" />
        )}
        {variant === "label" ? (pending ? "Preparing image…" : "Image unavailable") : null}
      </output>
    );
  }

  const outdated = snapshot.status === "outdated";
  const label = outdated ? "View previous image" : "View image";
  return (
    <div
      ref={wrapperRef}
      {...stylex.props(snapshotStyles.trigger, variant === "icon" && snapshotStyles.triggerIcon)}
      data-marimo-lens-snapshot-trigger
      data-status={outdated ? "outdated" : "ready"}
      onBlur={(event) => {
        if (
          pinned &&
          (!isNode(event.relatedTarget, event.currentTarget.ownerDocument) ||
            !event.currentTarget.contains(event.relatedTarget))
        ) {
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        {...stylex.props(
          ...(variant === "icon"
            ? iconButtonStyles
            : [ui.interactive, ui.pressable, ui.control, snapshotStyles.triggerButton]),
        )}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} for ${selection.label}.`}
        title={label}
        onPointerEnter={() => {
          if (!pinned) scheduleOpen();
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (suppressFocusOpen.current) {
            suppressFocusOpen.current = false;
            return;
          }
          show("instant");
        }}
        onBlur={(event) => {
          if (
            isNode(event.relatedTarget, event.currentTarget.ownerDocument) &&
            wrapperRef.current?.contains(event.relatedTarget)
          ) {
            return;
          }
          if (!pinned) close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          close();
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (open && pinned) {
            close();
            return;
          }
          setPinned(true);
          show("animate");
          if (event.detail === 0 && dom.activeElement === event.currentTarget) {
            event.currentTarget.ownerDocument.defaultView?.queueMicrotask(() => {
              wrapperRef.current
                ?.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')
                ?.focus({ preventScroll: true });
            });
          }
        }}
      >
        {outdated ? (
          <Clock3 size={variant === "icon" ? 15 : 13} aria-hidden="true" />
        ) : (
          <ImageIcon size={variant === "icon" ? 15 : 13} aria-hidden="true" />
        )}
        {variant === "label" ? label : null}
      </button>

      {open ? (
        <SnapshotPreviewDialog
          surfaceRef={surfaceRef}
          selectionLabel={selection.label}
          snapshot={snapshot}
          position={position}
          motion={motion}
          current={current}
          loading={loading}
          error={error}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
          onClose={closeAndRestoreFocus}
        />
      ) : null}
    </div>
  );
}

function useSnapshotAsset({
  selectionId,
  snapshotKey,
  sha256,
  stored,
  snapshotLoader,
  triggerRef,
}: {
  selectionId: string;
  snapshotKey: string;
  sha256: string;
  stored: boolean;
  snapshotLoader: SelectionSnapshotLoader;
  triggerRef: RefObject<HTMLButtonElement | null>;
}): SnapshotAssetController {
  const loadGeneration = useRef(0);
  const leaseRef = useRef<{
    key: string;
    lease: SelectionSnapshotLease;
    load: Promise<void>;
  } | null>(null);
  const loadedRef = useRef<LoadedSnapshot | null>(null);
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispose = useCallback((updateState: boolean) => {
    loadGeneration.current += 1;
    leaseRef.current?.lease.release();
    leaseRef.current = null;
    if (loadedRef.current) {
      loadedRef.current.urlApi.revokeObjectURL(loadedRef.current.url);
    }
    loadedRef.current = null;
    if (!updateState) return;
    setLoaded(null);
    setLoading(false);
    setError(null);
  }, []);

  const release = useCallback(() => dispose(true), [dispose]);

  const ensureLoaded = useCallback((): Promise<void> => {
    if (!stored) {
      dispose(true);
      return Promise.resolve();
    }
    if (loadedRef.current?.key === snapshotKey) return Promise.resolve();
    const existing = leaseRef.current;
    if (existing?.key === snapshotKey) return existing.load;

    dispose(true);
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true);
    setError(null);
    const lease = snapshotLoader.acquire(selectionId, sha256);
    const active = {
      key: snapshotKey,
      lease,
      load: Promise.resolve(),
    };
    active.load = (async () => {
      try {
        const asset = await lease.asset;
        if (loadGeneration.current !== generation || leaseRef.current !== active) return;
        const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
        if (!ownerWindow) throw new Error("Snapshot preview is detached from its document");
        const urlApi = ownerWindow.URL;
        const url = urlApi.createObjectURL(
          new ownerWindow.Blob([copyArrayBuffer(asset.bytes)], {
            type: asset.snapshot.mediaType,
          }),
        );
        const next = { key: snapshotKey, asset, url, urlApi };
        loadedRef.current = next;
        setLoaded(next);
      } catch (caught) {
        if (loadGeneration.current !== generation || leaseRef.current !== active) return;
        setError(errorMessage(caught, "Snapshot could not be loaded"));
      } finally {
        if (loadGeneration.current === generation && leaseRef.current === active) setLoading(false);
      }
    })();
    leaseRef.current = active;
    return active.load;
  }, [dispose, selectionId, sha256, snapshotKey, snapshotLoader, stored, triggerRef]);

  useEffect(() => () => dispose(false), [dispose]);

  return {
    current: loaded?.key === snapshotKey ? loaded : null,
    loading,
    error,
    ensureLoaded,
    release,
  };
}

function elementAnchor(element: Element | null): AnchoredSurfaceAnchor | null {
  return element ? { element, rect: element.getBoundingClientRect() } : null;
}

function isNode(value: EventTarget | null, ownerDocument: Document): value is Node {
  const NodeConstructor = ownerDocument.defaultView?.Node;
  return NodeConstructor ? value instanceof NodeConstructor : false;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
