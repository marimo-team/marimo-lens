import type { StoredSnapshot } from "@marimo-lens/protocol";
import type { RefObject } from "react";

import * as stylex from "@stylexjs/stylex";
import { AlertCircle, LoaderCircle, X } from "lucide-react";

import type { SnapshotAsset } from "@/anywidget/client";
import type { AnchoredSurfacePosition } from "@/ui/anchored-surface";

import { iconButtonStyles, ui } from "@/styles/primitives";

import { snapshotDialogStyles } from "./selection-snapshot-dialog.styles";

export type LoadedSnapshot = {
  key: string;
  asset: SnapshotAsset;
  url: string;
  urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};

export function SnapshotPreviewDialog({
  surfaceRef,
  selectionLabel,
  snapshot,
  position,
  motion,
  current,
  loading,
  error,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: {
  surfaceRef: RefObject<HTMLDialogElement | null>;
  selectionLabel: string;
  snapshot: StoredSnapshot;
  position: AnchoredSurfacePosition;
  motion: "animate" | "instant";
  current: LoadedSnapshot | null;
  loading: boolean;
  error: string | null;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClose: () => void;
}) {
  return (
    <dialog
      ref={surfaceRef}
      open
      {...stylex.props(
        snapshotDialogStyles.preview,
        position.placement === "above" ? snapshotDialogStyles.above : snapshotDialogStyles.below,
        motion === "instant" ? snapshotDialogStyles.instant : snapshotDialogStyles.animated,
      )}
      style={position.style}
      data-placement={position.placement}
      data-instant={motion === "instant" ? "true" : "false"}
      data-marimo-lens-snapshot-preview
      aria-label={`Selection image for ${selectionLabel}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <header {...stylex.props(snapshotDialogStyles.header)}>
        <div {...stylex.props(snapshotDialogStyles.heading)}>
          <strong {...stylex.props(snapshotDialogStyles.title)}>Selection image</strong>
          <span {...stylex.props(snapshotDialogStyles.metadata)}>
            {selectionLabel} · {snapshot.width} × {snapshot.height}
          </span>
        </div>
        <button
          {...stylex.props(...iconButtonStyles)}
          type="button"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div
        {...stylex.props(snapshotDialogStyles.image)}
        data-marimo-lens-snapshot-image-container
        aria-busy={loading ? "true" : undefined}
      >
        {current ? (
          <img
            {...stylex.props(snapshotDialogStyles.bitmap)}
            data-marimo-lens-snapshot-image
            src={current.url}
            width={current.asset.snapshot.width}
            height={current.asset.snapshot.height}
            alt={`Captured output for ${selectionLabel}`}
          />
        ) : loading ? (
          <span {...stylex.props(snapshotDialogStyles.imageStatus)}>
            <LoaderCircle {...stylex.props(ui.spin)} size={16} aria-hidden="true" /> Loading image…
          </span>
        ) : (
          <span
            {...stylex.props(snapshotDialogStyles.imageStatus, snapshotDialogStyles.imageError)}
            data-status="failed"
          >
            <AlertCircle size={16} aria-hidden="true" /> {error ?? "Image unavailable"}
          </span>
        )}
      </div>
      <footer {...stylex.props(snapshotDialogStyles.caption)} aria-live="polite">
        <span>This annotated image is available to vision-capable agents.</span>
        {snapshot.status === "outdated" ? (
          <strong {...stylex.props(snapshotDialogStyles.captionWarning)}>
            Captured before this selection moved.
          </strong>
        ) : null}
      </footer>
    </dialog>
  );
}
