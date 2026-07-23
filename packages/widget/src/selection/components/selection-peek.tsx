import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";
import type { PointerEventHandler } from "react";

import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";

import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";
import { useAnchoredSurface, type AnchoredSurfaceAnchor } from "@/ui/anchored-surface";

type SelectionPeekProps = {
  selection: Selection;
  anchorElement: HTMLElement;
  viewportAnchor: SelectionAnchor;
  capturing: boolean;
  motion: "animate" | "instant";
  snapshotLoader: SelectionSnapshotLoader;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDelete: (selection: Selection) => void;
  onClose: () => void;
  onPointerEnter: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
};

export function SelectionPeek({
  selection,
  anchorElement,
  viewportAnchor,
  capturing,
  motion,
  snapshotLoader,
  onEditNote,
  onDelete,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: SelectionPeekProps) {
  const anchor = surfaceAnchor(anchorElement, viewportAnchor);
  const position = useAnchoredSurface({
    anchor,
    open: true,
    preferredPlacement: anchor.rect.top < 160 ? "below" : "above",
    gap: 14,
    width: 264,
  });
  return (
    <section
      className="ml-selection-peek"
      style={position.style}
      data-placement={position.placement}
      data-instant={motion === "instant" ? "true" : "false"}
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-selection-peek={selection.id}
      aria-label={`Selection ${selection.label}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header className="ml-selection-peek__header">
        <span className="ml-label">{selection.label}</span>
        <span>
          Cell <span className="ml-code">{selection.outputCellId}</span>
          <span aria-hidden="true"> · </span>
          {selection.anchor.kind === "point" ? "Point" : "Region"}
        </span>
      </header>

      {selection.note ? <p>{selection.note}</p> : null}

      <footer className="ml-selection-peek__actions">
        <button
          className="ml-selection-peek__note"
          type="button"
          onClick={(event) => {
            onClose();
            onEditNote(selection, event.detail === 0 ? "instant" : "animate");
          }}
        >
          {selection.note ? (
            <Pencil size={13} aria-hidden="true" />
          ) : (
            <MessageSquarePlus size={13} aria-hidden="true" />
          )}
          {selection.note ? "Edit note" : "Add note"}
        </button>
        <div className="ml-selection-peek__secondary-actions">
          <SnapshotPreviewButton
            selection={selection}
            capturing={capturing}
            snapshotLoader={snapshotLoader}
          />
          <button
            className="ml-icon-button ml-icon-button--danger"
            type="button"
            onClick={() => {
              onClose();
              onDelete(selection);
            }}
            aria-label={`Remove selection ${selection.label}`}
            title="Remove selection"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}

function surfaceAnchor(element: HTMLElement, anchor: SelectionAnchor): AnchoredSurfaceAnchor {
  const anchorX = anchor.kind === "point" ? anchor.x : anchor.x + anchor.width / 2;
  const anchorTop = anchor.kind === "point" ? anchor.y : anchor.y;
  const anchorBottom = anchor.kind === "point" ? anchor.y : anchor.y + anchor.height;
  return {
    element,
    rect: {
      left: anchorX,
      right: anchorX,
      top: anchorTop,
      bottom: anchorBottom,
      width: 0,
      height: anchorBottom - anchorTop,
    },
  };
}
