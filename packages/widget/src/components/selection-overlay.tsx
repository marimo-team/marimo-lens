import { useEffect, useRef, useState } from "react";

import type { RectAnchor, Selection, SelectionAnchor } from "@/contracts";
import type { WorkflowState } from "@/state";

import {
  anchorToViewport,
  isAnchorInsideOutputViewport,
  resizeRectAnchor,
  translateAnchor,
  type ResizeHandle,
} from "@/capture/anchor";
import { getOutputCell } from "@/capture/output-root";
import { previewAnchor } from "@/state";
import { useViewportRevision } from "@/viewport";

type SelectionOverlayProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  workflow: WorkflowState;
  busySelectionIds: ReadonlySet<string>;
  capturingSelectionIds: ReadonlySet<string>;
  onActivate: (selection: Selection) => void;
  onReposition: (selection: Selection, anchor: SelectionAnchor) => void;
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
};

export type AdjustmentCancel = () => void;

export function SelectionOverlay({
  selections,
  currentSelectionId,
  workflow,
  busySelectionIds,
  capturingSelectionIds,
  onActivate,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
}: SelectionOverlayProps) {
  useViewportRevision();
  const activeCellId =
    workflow.mode === "armed"
      ? workflow.activeOutputCellId
      : workflow.mode === "dragging"
        ? workflow.output.id
        : null;
  const activeOutput = activeCellId ? getOutputCell(activeCellId)?.element : null;
  const activeBounds = activeOutput?.getBoundingClientRect();
  const draftAnchor = previewAnchor(workflow);

  return (
    <div
      className="ml-overlay"
      data-marimo-lens-ui
      data-armed={workflow.mode === "armed" || workflow.mode === "dragging"}
    >
      {activeBounds ? (
        <div
          className="ml-output-highlight"
          style={{
            left: activeBounds.left,
            top: activeBounds.top,
            width: activeBounds.width,
            height: activeBounds.height,
          }}
          aria-hidden="true"
        />
      ) : null}
      {workflow.mode === "dragging" && draftAnchor ? (
        <AnchorPreview output={workflow.output.element} anchor={draftAnchor} />
      ) : null}
      {selections.map((selection) => {
        const output = getOutputCell(selection.outputCellId)?.element;
        if (!output || !isAnchorInsideOutputViewport(output, selection.anchor)) return null;
        return (
          <SelectionMarker
            key={selection.id}
            selection={selection}
            output={output}
            current={selection.id === currentSelectionId}
            busy={busySelectionIds.has(selection.id)}
            capturing={capturingSelectionIds.has(selection.id)}
            onActivate={onActivate}
            onReposition={onReposition}
            registerAdjustment={registerAdjustment}
            releaseAdjustment={releaseAdjustment}
          />
        );
      })}
    </div>
  );
}

function AnchorPreview({ output, anchor }: { output: HTMLElement; anchor: SelectionAnchor }) {
  const viewport = anchorToViewport(output, anchor);
  return (
    <div
      className="ml-anchor-preview"
      data-kind={anchor.kind}
      style={anchorStyle(viewport)}
      aria-hidden="true"
    />
  );
}

function SelectionMarker({
  selection,
  output,
  current,
  busy,
  capturing,
  onActivate,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
}: {
  selection: Selection;
  output: HTMLElement;
  current: boolean;
  busy: boolean;
  capturing: boolean;
  onActivate: (selection: Selection) => void;
  onReposition: (selection: Selection, anchor: SelectionAnchor) => void;
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    cancel: AdjustmentCancel;
  } | null>(null);
  const suppressPointerClick = useRef(false);
  const [preview, setPreview] = useState<SelectionAnchor | null>(null);
  const viewport = anchorToViewport(output, preview ?? selection.anchor);

  useEffect(
    () => () => {
      const currentDrag = drag.current;
      if (!currentDrag) return;
      releaseAdjustment(currentDrag.cancel);
      drag.current = null;
    },
    [releaseAdjustment],
  );

  const marker = (
    <button
      className="ml-marker"
      data-kind={selection.anchor.kind}
      data-current={current ? "true" : "false"}
      data-busy={busy ? "true" : "false"}
      data-capturing={capturing ? "true" : "false"}
      data-marimo-lens-selection-id={selection.id}
      style={selection.anchor.kind === "point" ? anchorStyle(viewport) : undefined}
      type="button"
      disabled={busy}
      aria-current={current ? "true" : undefined}
      aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}. Drag to adjust.`}
      onFocus={() => onActivate(selection)}
      onClick={(event) => {
        if (event.detail === 0 && document.activeElement === event.currentTarget) return;
        if (event.detail > 0 && suppressPointerClick.current) {
          suppressPointerClick.current = false;
          return;
        }
        onActivate(selection);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        onActivate(selection);
        event.currentTarget.setPointerCapture(event.pointerId);
        const target = event.currentTarget;
        const cancel = () => {
          const currentDrag = drag.current;
          if (!currentDrag || currentDrag.cancel !== cancel) return;
          if (target.hasPointerCapture(currentDrag.pointerId)) {
            target.releasePointerCapture(currentDrag.pointerId);
          }
          drag.current = null;
          setPreview(null);
          releaseAdjustment(cancel);
        };
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          cancel,
        };
        registerAdjustment(cancel);
      }}
      onPointerMove={(event) => {
        const currentDrag = drag.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - currentDrag.startX;
        const deltaY = event.clientY - currentDrag.startY;
        if (Math.hypot(deltaX, deltaY) >= 4) currentDrag.moved = true;
        if (currentDrag.moved)
          setPreview(translateAnchor(output, selection.anchor, deltaX, deltaY));
      }}
      onPointerUp={(event) => {
        const currentDrag = drag.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        releaseAdjustment(currentDrag.cancel);
        drag.current = null;
        suppressPointerClick.current = true;
        window.setTimeout(() => {
          suppressPointerClick.current = false;
        }, 0);
        if (currentDrag.moved) {
          onReposition(
            selection,
            translateAnchor(
              output,
              selection.anchor,
              event.clientX - currentDrag.startX,
              event.clientY - currentDrag.startY,
            ),
          );
        }
        setPreview(null);
      }}
      onPointerCancel={() => {
        const currentDrag = drag.current;
        if (currentDrag) releaseAdjustment(currentDrag.cancel);
        drag.current = null;
        setPreview(null);
      }}
    >
      <span>{selection.label}</span>
    </button>
  );

  const rectAnchor = selection.anchor;
  if (rectAnchor.kind === "point" || viewport.kind === "point") return marker;

  return (
    <div
      className="ml-rect-marker"
      data-current={current ? "true" : "false"}
      data-busy={busy ? "true" : "false"}
      style={anchorStyle(viewport)}
    >
      {marker}
      {current
        ? RESIZE_HANDLES.map((handle) => (
            <ResizeHandleButton
              key={handle}
              selection={selection}
              anchor={rectAnchor}
              output={output}
              handle={handle}
              disabled={busy}
              onPreview={setPreview}
              onCommit={(anchor) => onReposition(selection, anchor)}
              registerAdjustment={registerAdjustment}
              releaseAdjustment={releaseAdjustment}
            />
          ))
        : null}
    </div>
  );
}

const RESIZE_HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

const HANDLE_NAMES: Record<ResizeHandle, string> = {
  nw: "top left",
  ne: "top right",
  sw: "bottom left",
  se: "bottom right",
};

function ResizeHandleButton({
  selection,
  anchor,
  output,
  handle,
  disabled,
  onPreview,
  onCommit,
  registerAdjustment,
  releaseAdjustment,
}: {
  selection: Selection;
  anchor: RectAnchor;
  output: HTMLElement;
  handle: ResizeHandle;
  disabled: boolean;
  onPreview: (anchor: RectAnchor | null) => void;
  onCommit: (anchor: RectAnchor) => void;
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
}) {
  const pointer = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    cancel: AdjustmentCancel;
  } | null>(null);
  const keyboardPreview = useRef<RectAnchor | null>(null);
  const keyboardCancel = useRef<AdjustmentCancel | null>(null);

  useEffect(
    () => () => {
      const pointerCancel = pointer.current?.cancel;
      if (pointerCancel) releaseAdjustment(pointerCancel);
      if (keyboardCancel.current) releaseAdjustment(keyboardCancel.current);
    },
    [releaseAdjustment],
  );

  const commitKeyboardPreview = () => {
    const next = keyboardPreview.current;
    if (!next) return;
    const cancel = keyboardCancel.current;
    if (cancel) releaseAdjustment(cancel);
    keyboardCancel.current = null;
    keyboardPreview.current = null;
    onPreview(null);
    onCommit(next);
  };

  return (
    <button
      className="ml-resize-handle"
      data-handle={handle}
      type="button"
      disabled={disabled}
      aria-label={`Resize selection ${selection.label} from ${HANDLE_NAMES[handle]}. Use arrow keys.`}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const target = event.currentTarget;
        const cancel = () => {
          const currentPointer = pointer.current;
          if (!currentPointer || currentPointer.cancel !== cancel) return;
          if (target.hasPointerCapture(currentPointer.pointerId)) {
            target.releasePointerCapture(currentPointer.pointerId);
          }
          pointer.current = null;
          onPreview(null);
          releaseAdjustment(cancel);
        };
        pointer.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          cancel,
        };
        registerAdjustment(cancel);
      }}
      onPointerMove={(event) => {
        const currentPointer = pointer.current;
        if (!currentPointer || currentPointer.pointerId !== event.pointerId) return;
        if (
          Math.hypot(
            event.clientX - currentPointer.startX,
            event.clientY - currentPointer.startY,
          ) >= 1
        ) {
          currentPointer.moved = true;
        }
        if (!currentPointer.moved) return;
        onPreview(
          resizeRectAnchor(
            output,
            anchor,
            handle,
            event.clientX - currentPointer.startX,
            event.clientY - currentPointer.startY,
          ),
        );
      }}
      onPointerUp={(event) => {
        const currentPointer = pointer.current;
        if (!currentPointer || currentPointer.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        releaseAdjustment(currentPointer.cancel);
        pointer.current = null;
        if (!currentPointer.moved) {
          onPreview(null);
          return;
        }
        onPreview(null);
        onCommit(
          resizeRectAnchor(
            output,
            anchor,
            handle,
            event.clientX - currentPointer.startX,
            event.clientY - currentPointer.startY,
          ),
        );
      }}
      onPointerCancel={() => {
        const currentPointer = pointer.current;
        if (currentPointer) releaseAdjustment(currentPointer.cancel);
        pointer.current = null;
        onPreview(null);
      }}
      onKeyDown={(event) => {
        const delta = keyboardDelta(output, event.key, event.shiftKey);
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        if (!keyboardCancel.current) {
          const cancel = () => {
            if (keyboardCancel.current !== cancel) return;
            keyboardCancel.current = null;
            keyboardPreview.current = null;
            onPreview(null);
            releaseAdjustment(cancel);
          };
          keyboardCancel.current = cancel;
          registerAdjustment(cancel);
        }
        const next = resizeRectAnchor(
          output,
          keyboardPreview.current ?? anchor,
          handle,
          delta.x,
          delta.y,
        );
        keyboardPreview.current = next;
        onPreview(next);
      }}
      onKeyUp={(event) => {
        if (!isArrowKey(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        commitKeyboardPreview();
      }}
      onBlur={commitKeyboardPreview}
    />
  );
}

function keyboardDelta(
  output: HTMLElement,
  key: string,
  largeStep: boolean,
): { x: number; y: number } | null {
  if (!isArrowKey(key)) return null;
  const bounds = output.getBoundingClientRect();
  const width = Math.max(output.scrollWidth, bounds.width, 1);
  const height = Math.max(output.scrollHeight, bounds.height, 1);
  const step = largeStep ? 0.05 : 0.01;
  if (key === "ArrowLeft") return { x: -width * step, y: 0 };
  if (key === "ArrowRight") return { x: width * step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -height * step };
  return { x: 0, y: height * step };
}

function isArrowKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

function anchorStyle(anchor: ReturnType<typeof anchorToViewport>): React.CSSProperties {
  if (anchor.kind === "point") return { left: anchor.x, top: anchor.y };
  return { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height };
}
