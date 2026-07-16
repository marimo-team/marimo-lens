import { AlertCircle, Camera, Clock3, LoaderCircle, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { Selection } from "@/contracts";
import type { SnapshotAsset } from "@/protocol";

type SnapshotPreviewButtonProps = {
  selection: Selection;
  capturing: boolean;
  variant?: "icon" | "label";
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
};

type LoadedSnapshot = {
  key: string;
  asset: SnapshotAsset;
  url: string;
};

export function SnapshotPreviewButton({
  selection,
  capturing,
  variant = "label",
  loadSnapshot,
}: SnapshotPreviewButtonProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const loadGeneration = useRef(0);
  const loadedRef = useRef<LoadedSnapshot | null>(null);
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [motion, setMotion] = useState<"animate" | "instant">("animate");
  const [position, setPosition] = useState(() => previewPosition(null));
  const snapshot = selection.snapshot;
  const stored = snapshot.status === "available" || snapshot.status === "outdated";
  const snapshotKey = stored ? `${snapshot.id}:${snapshot.sha256}` : "";

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);

  const ensureLoaded = useCallback(async () => {
    if (!stored) return;
    if (loadedRef.current?.key === snapshotKey) return;
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true);
    setError(null);
    try {
      const asset = await loadSnapshot(selection.id);
      if (loadGeneration.current !== generation) return;
      if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.url);
      const url = URL.createObjectURL(
        new Blob([copyArrayBuffer(asset.bytes)], { type: asset.snapshot.mediaType }),
      );
      const next = { key: snapshotKey, asset, url };
      loadedRef.current = next;
      setLoaded(next);
    } catch (caught) {
      if (loadGeneration.current !== generation) return;
      setError(caught instanceof Error ? caught.message : "Snapshot could not be loaded");
    } finally {
      if (loadGeneration.current === generation) setLoading(false);
    }
  }, [loadSnapshot, selection.id, snapshotKey, stored]);

  const updatePosition = useCallback(() => {
    setPosition(previewPosition(triggerRef.current?.getBoundingClientRect() ?? null));
  }, []);

  const show = useCallback(
    (nextMotion: "animate" | "instant") => {
      clearTimers();
      setMotion(nextMotion);
      updatePosition();
      setOpen(true);
      void ensureLoaded();
    },
    [clearTimers, ensureLoaded, updatePosition],
  );

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(() => show("animate"), 180);
  }, [clearTimers, show]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    if (pinned) return;
    closeTimer.current = window.setTimeout(close, 120);
  }, [clearTimers, close, pinned]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updatePosition();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (open) void ensureLoaded();
  }, [ensureLoaded, open]);

  useEffect(() => {
    if (!pinned) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [close, pinned]);

  useEffect(
    () => () => {
      clearTimers();
      loadGeneration.current += 1;
      if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.url);
      loadedRef.current = null;
    },
    [clearTimers],
  );

  if (!stored) {
    const pending = capturing || snapshot.status === "pending";
    return (
      <span
        className={`ml-snapshot-trigger ml-snapshot-trigger--${variant}`}
        data-status={pending ? "capturing" : "failed"}
        title={pending ? "Preparing snapshot" : "Snapshot unavailable"}
      >
        {pending ? (
          <LoaderCircle className="ml-spin" size={13} aria-hidden="true" />
        ) : (
          <AlertCircle size={13} aria-hidden="true" />
        )}
        {variant === "label" ? (pending ? "Preparing snapshot…" : "Snapshot unavailable") : null}
      </span>
    );
  }

  const current = loaded?.key === snapshotKey ? loaded : null;
  const outdated = snapshot.status === "outdated";
  const label = outdated ? "Snapshot outdated" : "Snapshot ready";
  return (
    <div
      ref={wrapperRef}
      className={`ml-snapshot-trigger ml-snapshot-trigger--${variant}`}
      data-status={outdated ? "outdated" : "ready"}
    >
      <button
        ref={triggerRef}
        className={variant === "icon" ? "ml-icon-button" : "ml-snapshot-trigger__button"}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} for ${selection.label}. Preview image.`}
        title={label}
        onPointerEnter={() => {
          if (!pinned) scheduleOpen();
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => show("instant")}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
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
        onClick={() => {
          if (open && pinned) {
            close();
            return;
          }
          setPinned(true);
          show("animate");
        }}
      >
        {outdated ? (
          <Clock3 size={variant === "icon" ? 15 : 13} aria-hidden="true" />
        ) : (
          <Camera size={variant === "icon" ? 15 : 13} aria-hidden="true" />
        )}
        {variant === "label" ? label : null}
      </button>

      {open ? (
        <dialog
          open
          className="ml-snapshot-preview"
          style={position.style}
          data-placement={position.placement}
          data-instant={motion === "instant" ? "true" : "false"}
          data-marimo-lens-snapshot-preview
          aria-label={`Snapshot preview for ${selection.label}`}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close();
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <header className="ml-snapshot-preview__header">
            <div>
              <strong>Snapshot preview</strong>
              <span>
                {selection.label} · {snapshot.width} × {snapshot.height}
              </span>
            </div>
            <button
              className="ml-icon-button"
              type="button"
              onClick={close}
              aria-label="Close preview"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="ml-snapshot-preview__image" aria-busy={loading ? "true" : undefined}>
            {current ? (
              <img
                src={current.url}
                width={current.asset.snapshot.width}
                height={current.asset.snapshot.height}
                alt={`Captured output for ${selection.label}`}
              />
            ) : loading ? (
              <span>
                <LoaderCircle className="ml-spin" size={16} aria-hidden="true" /> Loading snapshot…
              </span>
            ) : (
              <span data-status="failed">
                <AlertCircle size={16} aria-hidden="true" /> {error ?? "Snapshot unavailable"}
              </span>
            )}
          </div>
          <footer className="ml-snapshot-preview__caption">
            <span>This is the snapshot an image-capable agent receives.</span>
            {outdated ? <strong>Captured before this selection moved.</strong> : null}
          </footer>
        </dialog>
      ) : null}
    </div>
  );
}

function previewPosition(rect: DOMRect | null): {
  style: CSSProperties;
  placement: "above" | "below";
} {
  if (!rect || typeof window === "undefined") {
    return { style: { left: 12, bottom: 64 }, placement: "above" };
  }
  const width = Math.min(336, window.innerWidth - 24);
  const left = clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12);
  const placeBelow = rect.top < 300;
  return {
    style: placeBelow
      ? { left, top: rect.bottom + 8, width }
      : { left, bottom: window.innerHeight - rect.top + 8, width },
    placement: placeBelow ? "below" : "above",
  };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
