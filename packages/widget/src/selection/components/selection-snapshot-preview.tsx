import type { Selection, StoredSnapshot } from "@marimo-lens/protocol";
import type { FocusEvent, KeyboardEvent, MouseEvent } from "react";

import * as stylex from "@stylexjs/stylex";
import { AlertCircle, Clock3, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import type { SnapshotAsset } from "@/anywidget/client";

import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { iconButtonStyles, ui } from "@/styles/primitives";
import { useAnchoredSurface } from "@/ui/anchored-surface";
import { useObjectUrl } from "@/ui/use-object-url";

import { SnapshotPreviewDialog } from "./selection-snapshot-dialog";
import { snapshotStyles } from "./selection-snapshot-preview.styles";

type LoadSnapshot = (selectionId: string) => Promise<SnapshotAsset>;

type SnapshotPreviewButtonProps = {
  selection: Selection;
  loadSnapshot: LoadSnapshot;
};

/** Preview a selection's stored image, or say that it is still capturing or unavailable. */
export function SnapshotPreviewButton({ selection, loadSnapshot }: SnapshotPreviewButtonProps) {
  const snapshot = selection.snapshot;
  if (snapshot.status === "available" || snapshot.status === "outdated") {
    return (
      <StoredSnapshotPreview
        selection={selection}
        snapshot={snapshot}
        loadSnapshot={loadSnapshot}
      />
    );
  }
  return <SnapshotStatusMark pending={snapshot.status === "pending"} />;
}

function SnapshotStatusMark({ pending }: { pending: boolean }) {
  const label = pending ? "Preparing image" : "Image unavailable";
  return (
    <output
      {...stylex.props(
        snapshotStyles.trigger,
        snapshotStyles.triggerIcon,
        !pending && snapshotStyles.triggerFailed,
      )}
      data-marimo-lens-snapshot-trigger
      data-status={pending ? "capturing" : "failed"}
      title={label}
      aria-label={label}
    >
      {pending ? (
        <LoaderCircle {...stylex.props(ui.spin)} size={13} aria-hidden="true" />
      ) : (
        <AlertCircle size={13} aria-hidden="true" />
      )}
    </output>
  );
}

/**
 * Open the preview on hover after a short delay, at once on focus, and pinned
 * on click. A pinned preview stays until a click outside, Escape, or a second
 * click, and the image loads only while the preview is open.
 */
function StoredSnapshotPreview({
  selection,
  snapshot,
  loadSnapshot,
}: {
  selection: Selection;
  snapshot: StoredSnapshot;
  loadSnapshot: LoadSnapshot;
}) {
  const dom = useNotebookDom();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDialogElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const timerWindow = useRef<Window | null>(null);
  const suppressFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  // The trigger as state, so placement reads no ref while rendering.
  const [anchorElement, setAnchorElement] = useState<HTMLButtonElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const [motion, setMotion] = useState<"animate" | "instant">("animate");
  const image = useObjectUrl(open ? `${selection.id}:${snapshot.sha256}` : null, async () => {
    const asset = await loadSnapshot(selection.id);
    if (asset.snapshot.sha256 !== snapshot.sha256) {
      throw new Error("Snapshot changed before the preview loaded");
    }
    return asset.bytes;
  });
  const anchor = anchorElement
    ? { element: anchorElement, rect: anchorElement.getBoundingClientRect() }
    : null;
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
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);
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
    },
    [clearTimers],
  );

  const schedule = useCallback(
    (timer: typeof openTimer, run: () => void, delay: number) => {
      clearTimers();
      const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
      if (!ownerWindow) return;
      timerWindow.current = ownerWindow;
      timer.current = ownerWindow.setTimeout(run, delay);
    },
    [clearTimers],
  );
  const scheduleClose = useCallback(() => {
    if (pinned) clearTimers();
    else schedule(closeTimer, close, 120);
  }, [clearTimers, close, pinned, schedule]);

  useEffect(() => {
    if (!pinned) return undefined;
    const ownerDocument = wrapperRef.current?.ownerDocument;
    if (!ownerDocument) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!event.composedPath().includes(wrapperRef.current!)) closeFromOutside();
    };
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    return () => ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
  }, [pinned]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onTriggerPointerEnter = () => {
    if (!pinned) schedule(openTimer, () => show("animate"), 180);
  };
  const onTriggerFocus = () => {
    if (suppressFocusOpen.current) {
      suppressFocusOpen.current = false;
      return;
    }
    show("instant");
  };
  const onTriggerBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (
      isNode(event.relatedTarget, event.currentTarget.ownerDocument) &&
      wrapperRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    if (!pinned) close();
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    close();
    triggerRef.current?.focus({ preventScroll: true });
  };
  const onTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (open && pinned) {
      close();
      return;
    }
    setPinned(true);
    show("animate");
    // A keyboard click moves focus into the pinned preview.
    if (event.detail === 0 && dom.activeElement === event.currentTarget) {
      event.currentTarget.ownerDocument.defaultView?.queueMicrotask(() => {
        wrapperRef.current
          ?.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')
          ?.focus({ preventScroll: true });
      });
    }
  };

  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (
      pinned &&
      (!isNode(event.relatedTarget, event.currentTarget.ownerDocument) ||
        !event.currentTarget.contains(event.relatedTarget))
    ) {
      close();
    }
  };

  const outdated = snapshot.status === "outdated";
  const label = outdated ? "View previous image" : "View image";
  const Icon = outdated ? Clock3 : ImageIcon;
  return (
    <div
      ref={wrapperRef}
      {...stylex.props(snapshotStyles.trigger, snapshotStyles.triggerIcon)}
      data-marimo-lens-snapshot-trigger
      data-status={outdated ? "outdated" : "ready"}
      onBlur={closeWhenFocusLeaves}
    >
      <button
        ref={triggerRef}
        {...stylex.props(...iconButtonStyles)}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} for ${selection.label}.`}
        title={label}
        onPointerEnter={onTriggerPointerEnter}
        onPointerLeave={scheduleClose}
        onFocus={onTriggerFocus}
        onBlur={onTriggerBlur}
        onKeyDown={onTriggerKeyDown}
        onClick={onTriggerClick}
      >
        <Icon size={15} aria-hidden="true" />
      </button>

      {open ? (
        <SnapshotPreviewDialog
          surfaceRef={surfaceRef}
          selectionLabel={selection.label}
          snapshot={snapshot}
          position={position}
          motion={motion}
          image={image}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
          onClose={closeAndRestoreFocus}
        />
      ) : null}
    </div>
  );
}

function isNode(value: EventTarget | null, ownerDocument: Document): value is Node {
  const NodeConstructor = ownerDocument.defaultView?.Node;
  return NodeConstructor ? value instanceof NodeConstructor : false;
}
