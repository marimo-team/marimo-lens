import { useId, type MouseEvent as ReactMouseEvent } from "react";

import type { useDraggableDock } from "@/hooks/use-draggable-dock";

import { IconLensMark } from "@/components/icons";
import { LensActions } from "@/components/lens-actions";
import { LensTooltip } from "@/components/lens-tooltip";

type LensToolbarProps = {
  title?: string;
  open: boolean;
  armed: boolean;
  copied: boolean;
  copying: boolean;
  copyError: string;
  dragging: boolean;
  inventoryOpen: boolean;
  markersVisible: boolean;
  noteCount: number;
  settingsOpen: boolean;
  dragProps: ReturnType<typeof useDraggableDock>["dockDragProps"];
  onToggleOpen: () => void;
  onToggleCapture: () => void;
  onCopy: () => void;
  onScan: () => void;
  onClear: () => void;
  onToggleInventory: () => void;
  onToggleMarkersVisible: () => void;
  onToggleSettings: () => void;
  consumeDragClick: () => boolean;
};

export function LensToolbar({
  title,
  open,
  armed,
  copied,
  copying,
  copyError,
  dragging,
  inventoryOpen,
  markersVisible,
  noteCount,
  settingsOpen,
  dragProps,
  onToggleOpen,
  onToggleCapture,
  onCopy,
  onScan,
  onClear,
  onToggleInventory,
  onToggleMarkersVisible,
  onToggleSettings,
  consumeDragClick,
}: LensToolbarProps) {
  const label = title || "marimo lens";
  const toggleLabel = open ? "Collapse Lens" : "Open Lens";
  const controlsId = useId();
  const toggleDescriptionId = useId();
  const { onKeyDown, ...pointerDragProps } = dragProps;
  const openCollapsedToolbar = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (open || event.target !== event.currentTarget) return;
    if (consumeDragClick()) return;
    onToggleOpen();
  };
  return (
    <div
      {...pointerDragProps}
      className="ml-toolbar"
      role="toolbar"
      tabIndex={-1}
      aria-label={`${label} controls`}
      onKeyDown={onKeyDown}
      onClick={openCollapsedToolbar}
      data-open={open ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
    >
      {!open ? (
        <LensTooltip content={`${toggleLabel}. Drag to move.`}>
          <button
            className="ml-toolbar-toggle"
            onClick={() => {
              if (consumeDragClick()) return;
              onToggleOpen();
            }}
            type="button"
            aria-label={toggleLabel}
            aria-describedby={toggleDescriptionId}
            aria-expanded={open}
            aria-controls={controlsId}
            data-marimo-lens-tooltip={toggleLabel}
          >
            <IconLensMark size={22} />
            {noteCount > 0 ? <span className="ml-toolbar-badge">{noteCount}</span> : null}
            <span id={toggleDescriptionId} className="ml-sr-only">
              {toggleLabel}. Drag to move.
            </span>
          </button>
        </LensTooltip>
      ) : null}
      <div
        id={controlsId}
        className="ml-toolbar-controls"
        aria-hidden={open ? undefined : "true"}
        inert={!open}
      >
        <LensActions
          armed={armed}
          copied={copied}
          copying={copying}
          copyError={copyError}
          interactive={open}
          inventoryOpen={inventoryOpen}
          markersVisible={markersVisible}
          noteCount={noteCount}
          settingsOpen={settingsOpen}
          onCopy={onCopy}
          onScan={onScan}
          onClear={onClear}
          onClose={onToggleOpen}
          onToggleInventory={onToggleInventory}
          onToggleMarkersVisible={onToggleMarkersVisible}
          onToggleSettings={onToggleSettings}
          onToggleCapture={onToggleCapture}
        />
      </div>
    </div>
  );
}
