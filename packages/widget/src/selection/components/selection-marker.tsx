import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom-context";
import {
  anchorToViewport,
  isViewportAnchorInsideOutput,
  translateAnchor,
} from "@/selection/anchor";
import { useScrollAttachment } from "@/selection/use-scroll-attachment";
import { ui } from "@/styles/primitives";

import { usePointerAdjustment, type AdjustmentSlot } from "./adjustment";
import { RESIZE_HANDLES, ResizeHandleButton } from "./resize-handle";
import { markerStyles } from "./selection-marker.styles";

type MarkerProps = AdjustmentSlot & {
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
};

/** Draw a selection's marker where its anchor shows, while the anchor is inside its output. */
export function SelectionMarker(props: MarkerProps) {
  const { selection, output, viewportRevision } = props;
  const dom = useNotebookDom();
  const [preview, setPreview] = useState<SelectionAnchor | null>(null);
  const attachment = useScrollAttachment(dom, output, selection.anchor, viewportRevision);
  const viewport = anchorToViewport(output, preview ?? selection.anchor, attachment);
  if (!isViewportAnchorInsideOutput(output, viewport, attachment)) return null;

  const anchor = selection.anchor;
  if (anchor.kind === "point" || viewport.kind === "point") {
    return (
      <MarkerButton
        {...props}
        style={anchor.kind === "point" ? anchorStyle(viewport) : undefined}
        onPreview={setPreview}
      />
    );
  }
  return (
    <RectMarkerFrame {...props} rect={anchor} style={anchorStyle(viewport)} onPreview={setPreview}>
      <MarkerButton {...props} onPreview={setPreview} />
    </RectMarkerFrame>
  );
}

function RectMarkerFrame({
  selection,
  rect,
  output,
  current,
  busy,
  interactionEnabled,
  style,
  onPreview,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
  children,
}: MarkerProps & {
  rect: Extract<SelectionAnchor, { kind: "rect" }>;
  style: React.CSSProperties;
  onPreview: (anchor: SelectionAnchor | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      {...stylex.props(markerStyles.rectContainer, busy && markerStyles.busy)}
      data-marimo-lens-rect-marker
      data-current={current ? "true" : "false"}
      data-busy={busy ? "true" : "false"}
      style={style}
    >
      {children}
      {current && interactionEnabled
        ? RESIZE_HANDLES.map((handle) => (
            <ResizeHandleButton
              key={handle}
              selection={selection}
              anchor={rect}
              output={output}
              handle={handle}
              disabled={busy}
              onPreview={onPreview}
              onCommit={(anchor) => onReposition(selection, anchor)}
              registerAdjustment={registerAdjustment}
              releaseAdjustment={releaseAdjustment}
            />
          ))
        : null}
    </div>
  );
}

function MarkerButton({
  style,
  onPreview,
  ...props
}: MarkerProps & {
  style?: React.CSSProperties;
  onPreview: (anchor: SelectionAnchor | null) => void;
}) {
  const { selection, output, current, busy, capturing, interactionEnabled } = props;
  const kind = selection.anchor.kind;
  const moved = (offset: { x: number; y: number }) =>
    translateAnchor(output, selection.anchor, offset.x, offset.y);
  // A press without movement opens the note, a drag past 4 pixels activates
  // the selection and previews the new anchor, and release commits it.
  const { endsPress, handlers } = usePointerAdjustment({
    threshold: 4,
    registerAdjustment: props.registerAdjustment,
    releaseAdjustment: props.releaseAdjustment,
    preview: (offset) => onPreview(offset && moved(offset)),
    onDragStart: () => props.onActivate(selection),
    onRelease: (offset) =>
      offset
        ? props.onReposition(selection, moved(offset))
        : props.onEditNote(selection, "animate"),
  });
  return (
    <button
      {...markerButtonProps(props)}
      data-kind={kind}
      data-current={String(current)}
      data-busy={String(busy)}
      data-capturing={String(capturing)}
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-selection-id={selection.id}
      style={style}
      type="button"
      disabled={busy || !interactionEnabled}
      aria-current={current ? "true" : undefined}
      aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}. Drag to adjust.`}
      onClick={(event) => {
        if (!endsPress(event)) {
          props.onEditNote(selection, event.detail === 0 ? "instant" : "animate");
        }
      }}
      {...handlers}
    >
      <span {...markerLabelProps(props)}>{selection.label}</span>
    </button>
  );
}

function markerButtonProps({
  selection,
  current,
  busy,
  capturing,
  interactionEnabled,
}: MarkerProps) {
  const point = selection.anchor.kind === "point";
  return stylex.props(
    ui.interactive,
    markerStyles.marker,
    point ? markerStyles.point : markerStyles.rect,
    current && (point ? markerStyles.pointCurrent : markerStyles.rectCurrent),
    busy && point && markerStyles.busy,
    capturing && markerStyles.capturing,
    !interactionEnabled && markerStyles.markerBlocked,
  );
}

function markerLabelProps({ selection, current }: MarkerProps) {
  const rect = selection.anchor.kind === "rect";
  return stylex.props(
    rect && markerStyles.rectLabel,
    rect && current && markerStyles.rectLabelCurrent,
  );
}

export function anchorStyle(anchor: ReturnType<typeof anchorToViewport>): React.CSSProperties {
  if (anchor.kind === "point") return { left: anchor.x, top: anchor.y };
  return { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height };
}
