import type { StoredSnapshot } from "@marimo-lens/protocol";
import type { RefObject } from "react";

import * as stylex from "@stylexjs/stylex";
import { AlertCircle, LoaderCircle, X } from "lucide-react";

import type { AnchoredSurfacePosition } from "@/ui/anchored-surface";
import type { ObjectUrl } from "@/ui/use-object-url";

import { errorMessage } from "@/anywidget/error";
import { iconButtonStyles, ui } from "@/styles/primitives";

import { snapshotDialogStyles } from "./selection-snapshot-dialog.styles";

export function SnapshotPreviewDialog({
  surfaceRef,
  selectionLabel,
  snapshot,
  position,
  motion,
  image,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: {
  surfaceRef: RefObject<HTMLDialogElement | null>;
  selectionLabel: string;
  snapshot: StoredSnapshot;
  position: AnchoredSurfacePosition;
  motion: "animate" | "instant";
  image: ObjectUrl | null;
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
        aria-busy={image === null ? "true" : undefined}
      >
        {image && "url" in image ? (
          <img
            {...stylex.props(snapshotDialogStyles.bitmap)}
            data-marimo-lens-snapshot-image
            src={image.url}
            width={snapshot.width}
            height={snapshot.height}
            alt={`Captured output for ${selectionLabel}`}
          />
        ) : image === null ? (
          <span {...stylex.props(snapshotDialogStyles.imageStatus)}>
            <LoaderCircle {...stylex.props(ui.spin)} size={16} aria-hidden="true" /> Loading image…
          </span>
        ) : (
          <span
            {...stylex.props(snapshotDialogStyles.imageStatus, snapshotDialogStyles.imageError)}
            data-status="failed"
          >
            <AlertCircle size={16} aria-hidden="true" />{" "}
            {errorMessage(image.error, "Snapshot could not be loaded")}
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
