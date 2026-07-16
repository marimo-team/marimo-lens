import type { CSSProperties, PointerEventHandler } from "react";

import { MessageSquarePlus, Pencil } from "lucide-react";

import type { Selection, SelectionAnchor } from "@/contracts";
import type { SnapshotAsset } from "@/protocol";

import { SnapshotPreviewButton } from "@/components/selection-snapshot-preview";

type SelectionPeekProps = {
  selection: Selection;
  viewportAnchor: SelectionAnchor;
  capturing: boolean;
  motion: "animate" | "instant";
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onClose: () => void;
  onPointerEnter: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
};

export function SelectionPeek({
  selection,
  viewportAnchor,
  capturing,
  motion,
  loadSnapshot,
  onEditNote,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: SelectionPeekProps) {
  const position = peekPosition(viewportAnchor);
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
        <SnapshotPreviewButton
          selection={selection}
          capturing={capturing}
          loadSnapshot={loadSnapshot}
        />
      </footer>
    </section>
  );
}

function peekPosition(anchor: SelectionAnchor): {
  style: CSSProperties;
  placement: "above" | "below";
} {
  const width = Math.min(264, window.innerWidth - 24);
  const anchorX = anchor.kind === "point" ? anchor.x : anchor.x + anchor.width / 2;
  const anchorTop = anchor.kind === "point" ? anchor.y : anchor.y;
  const anchorBottom = anchor.kind === "point" ? anchor.y : anchor.y + anchor.height;
  const left = clamp(anchorX - width / 2, 12, window.innerWidth - width - 12);
  const placeBelow = anchorTop < 160;
  return {
    style: placeBelow
      ? { left, top: anchorBottom + 14, width }
      : { left, bottom: window.innerHeight - anchorTop + 14, width },
    placement: placeBelow ? "below" : "above",
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
