import type { RectAnchor, Selection, SelectionAnchor, TargetSelector } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { WorkflowState } from "@/selection/state";

import { useNotebookDom, type NotebookDomAdapter } from "@/notebook/notebook-dom";
import { useViewportRevision } from "@/notebook/viewport";
import {
  anchorToViewport,
  attachToNestedScroll,
  isViewportAnchorInsideOutput,
  resizeRectAnchor,
  type ScrollAttachment,
  translateAnchor,
  type ResizeHandle,
} from "@/selection/anchor";
import { previewAnchor } from "@/selection/state";
import { TargetInfoLabel } from "@/ui/components/target-info";

import { ui } from "../../styles/primitives";
import { overlayStyles } from "./selection-overlay.styles";

type SelectionOverlayProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  availableSelectionIds: ReadonlySet<string>;
  selector: TargetSelector;
  workflow: WorkflowState;
  busySelectionIds: ReadonlySet<string>;
  capturingSelectionIds: ReadonlySet<string>;
  onActivate: (selection: Selection) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onReposition: (selection: Selection, anchor: SelectionAnchor) => void;
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
};

export type AdjustmentCancel = () => void;

export function SelectionOverlay({
  selections,
  currentSelectionId,
  availableSelectionIds,
  selector,
  workflow,
  busySelectionIds,
  capturingSelectionIds,
  onActivate,
  onEditNote,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
}: SelectionOverlayProps) {
  const dom = useNotebookDom();
  const interactionActive = workflow.mode === "armed" || workflow.mode === "dragging";
  const viewportRevision = useViewportRevision(
    selections.length > 0 || interactionActive,
    selector,
  );
  const candidateTarget =
    workflow.mode === "armed"
      ? workflow.activeTarget
      : workflow.mode === "dragging"
        ? workflow.target
        : null;
  const currentTarget = candidateTarget
    ? dom.targetFromElement(candidateTarget.element, selector)
    : null;
  const activeTarget = currentTarget?.element === candidateTarget?.element ? currentTarget : null;
  const activeOutput = activeTarget?.element ?? null;
  const activeBounds = activeOutput?.getBoundingClientRect();
  const draftAnchor = previewAnchor(workflow);

  return (
    <div
      {...stylex.props(overlayStyles.overlay)}
      data-marimo-lens-ui
      data-armed={interactionActive}
    >
      {workflow.mode === "armed" && activeTarget && activeBounds && (
        <TargetInfoLabel target={activeTarget} bounds={activeBounds} />
      )}
      {activeBounds ? (
        <div
          {...stylex.props(overlayStyles.fixedAnchor, overlayStyles.outputHighlight)}
          data-marimo-lens-output-highlight
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
        <AnchorPreview output={workflow.target.element} anchor={draftAnchor} />
      ) : null}
      {selections.map((selection) => {
        if (!availableSelectionIds.has(selection.id)) return null;
        const output = dom.getTarget(selection.target, selector)?.element;
        if (!output) return null;
        return (
          <SelectionMarker
            key={selection.id}
            selection={selection}
            output={output}
            viewportRevision={viewportRevision}
            current={selection.id === currentSelectionId}
            busy={busySelectionIds.has(selection.id)}
            capturing={capturingSelectionIds.has(selection.id)}
            interactionEnabled={workflow.mode === "idle"}
            onActivate={onActivate}
            onEditNote={onEditNote}
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
      {...stylex.props(
        overlayStyles.fixedAnchor,
        overlayStyles.anchorPreview,
        anchor.kind === "point" ? overlayStyles.anchorPoint : overlayStyles.anchorRect,
      )}
      data-kind={anchor.kind}
      style={anchorStyle(viewport)}
      aria-hidden="true"
    />
  );
}

function SelectionMarker({
  selection,
  output,
  viewportRevision,
  current,
  busy,
  capturing,
  interactionEnabled,
  onActivate,
  onEditNote,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
}: {
  selection: Selection;
  output: HTMLElement;
  viewportRevision: number;
  current: boolean;
  busy: boolean;
  capturing: boolean;
  interactionEnabled: boolean;
  onActivate: (selection: Selection) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onReposition: (selection: Selection, anchor: SelectionAnchor) => void;
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
}) {
  const dom = useNotebookDom();
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    cancel: AdjustmentCancel;
  } | null>(null);
  const suppressPointerClick = useRef(false);
  const [preview, setPreview] = useState<SelectionAnchor | null>(null);
  const anchorKey = JSON.stringify(selection.anchor);
  const [attachmentState, setAttachmentState] = useState(() =>
    createScrollAttachmentState(dom, output, selection.anchor, anchorKey),
  );
  useLayoutEffect(() => {
    setAttachmentState((current) =>
      refreshScrollAttachmentState(current, dom, output, selection.anchor, anchorKey),
    );
  }, [anchorKey, dom, output, selection.anchor, viewportRevision]);
  const attachment = attachmentState.attachment;
  const displayedAnchor = preview ?? selection.anchor;
  const viewport = anchorToViewport(output, displayedAnchor, attachment);

  useEffect(
    () => () => {
      const currentDrag = drag.current;
      if (currentDrag) {
        releaseAdjustment(currentDrag.cancel);
        drag.current = null;
      }
    },
    [releaseAdjustment],
  );

  if (!isViewportAnchorInsideOutput(output, viewport, attachment)) return null;

  const marker = (
    <button
      {...stylex.props(
        ui.interactive,
        overlayStyles.marker,
        selection.anchor.kind === "point" ? overlayStyles.point : overlayStyles.rect,
        current &&
          (selection.anchor.kind === "point"
            ? overlayStyles.pointCurrent
            : overlayStyles.rectCurrent),
        busy && selection.anchor.kind === "point" && overlayStyles.busy,
        capturing && overlayStyles.capturing,
        !interactionEnabled && overlayStyles.markerBlocked,
      )}
      data-kind={selection.anchor.kind}
      data-current={current ? "true" : "false"}
      data-busy={busy ? "true" : "false"}
      data-capturing={capturing ? "true" : "false"}
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-selection-id={selection.id}
      style={selection.anchor.kind === "point" ? anchorStyle(viewport) : undefined}
      type="button"
      disabled={busy || !interactionEnabled}
      aria-current={current ? "true" : undefined}
      aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}. Drag to adjust.`}
      onClick={(event) => {
        if (event.detail > 0 && suppressPointerClick.current) {
          suppressPointerClick.current = false;
          return;
        }
        onEditNote(selection, event.detail === 0 ? "instant" : "animate");
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
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
        if (!currentDrag.moved && Math.hypot(deltaX, deltaY) >= 4) {
          currentDrag.moved = true;
          onActivate(selection);
        }
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
        dom.window.setTimeout(() => {
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
        } else {
          onEditNote(selection, "animate");
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
      <span
        {...stylex.props(
          selection.anchor.kind === "rect" && overlayStyles.rectLabel,
          selection.anchor.kind === "rect" && current && overlayStyles.rectLabelCurrent,
        )}
      >
        {selection.label}
      </span>
    </button>
  );

  const rectAnchor = selection.anchor;
  if (rectAnchor.kind === "point" || viewport.kind === "point") {
    return marker;
  }

  return (
    <div
      {...stylex.props(overlayStyles.rectContainer, busy && overlayStyles.busy)}
      data-marimo-lens-rect-marker
      data-current={current ? "true" : "false"}
      data-busy={busy ? "true" : "false"}
      style={anchorStyle(viewport)}
    >
      {marker}
      {current && interactionEnabled
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

type ScrollAttachmentState = {
  output: HTMLElement;
  anchor: string;
  contentRevision: number;
  target: Element | null;
  attachment: ScrollAttachment;
};

function createScrollAttachmentState(
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
  anchorKey: string,
): ScrollAttachmentState {
  const target = attachmentTarget(dom, output, anchor);
  return {
    output,
    anchor: anchorKey,
    contentRevision: dom.contentRevision(output),
    target,
    attachment: target
      ? attachToNestedScroll(output, target)
      : { frames: [], ancestorBaselines: [] },
  };
}

function refreshScrollAttachmentState(
  current: ScrollAttachmentState,
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
  anchorKey: string,
): ScrollAttachmentState {
  const reset = current.output !== output || current.anchor !== anchorKey;
  const contentRevision = dom.contentRevision(output);
  const target =
    reset ||
    current.target === null ||
    !current.target.isConnected ||
    (current.attachment.frames.length === 0 && current.contentRevision !== contentRevision)
      ? attachmentTarget(dom, output, anchor)
      : current.target;
  const attachment = target
    ? attachToNestedScroll(output, target, reset ? undefined : current.attachment)
    : { frames: [], ancestorBaselines: [] };
  if (
    !reset &&
    current.contentRevision === contentRevision &&
    current.target === target &&
    hasSameScrollAttachment(current.attachment, attachment)
  ) {
    return current;
  }
  return {
    output,
    anchor: anchorKey,
    contentRevision,
    target,
    attachment,
  };
}

function attachmentTarget(
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
): Element | null {
  const viewport = anchorToViewport(output, anchor);
  const point =
    viewport.kind === "point"
      ? viewport
      : { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  return "elementsFromPoint" in dom.document ? dom.deepestElementAtPoint(point.x, point.y) : null;
}

function hasSameScrollAttachment(first: ScrollAttachment, second: ScrollAttachment): boolean {
  return (
    hasSameElements(first.frames, second.frames) &&
    hasSameElements(first.ancestorBaselines, second.ancestorBaselines)
  );
}

function hasSameElements(
  first: ReadonlyArray<{ element: Element }>,
  second: ReadonlyArray<{ element: Element }>,
): boolean {
  return (
    first.length === second.length &&
    first.every((item, index) => item.element === second[index]?.element)
  );
}

const RESIZE_HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

const HANDLE_NAMES = {
  nw: "top left",
  ne: "top right",
  sw: "bottom left",
  se: "bottom right",
} satisfies Record<ResizeHandle, string>;

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
      {...stylex.props(ui.interactive, overlayStyles.resizeHandle, overlayStyles[handle])}
      data-marimo-lens-resize-handle
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
