import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";

import type { WorkflowState } from "@/selection/state";

import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { useViewportRevision } from "@/notebook/use-viewport-revision";
import { anchorToViewport } from "@/selection/anchor";
import { previewAnchor } from "@/selection/state";
import { TargetInfoLabel } from "@/ui/components/target-info";

import type { AdjustmentSlot } from "./adjustment";

import { anchorStyle, SelectionMarker } from "./selection-marker";
import { overlayStyles } from "./selection-overlay.styles";

type SelectionOverlayProps = AdjustmentSlot & {
  selections: readonly Selection[];
  currentSelectionId: string | null;
  workflow: WorkflowState;
  busySelectionIds: ReadonlySet<string>;
  onActivate: (selection: Selection) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onReposition: (selection: Selection, anchor: SelectionAnchor) => void;
};

export function SelectionOverlay({
  selections,
  currentSelectionId,
  workflow,
  busySelectionIds,
  onActivate,
  onEditNote,
  onReposition,
  registerAdjustment,
  releaseAdjustment,
}: SelectionOverlayProps) {
  const dom = useNotebookDom();
  const interactionActive = workflow.mode === "armed" || workflow.mode === "dragging";
  const viewportRevision = useViewportRevision(selections.length > 0 || interactionActive);
  const candidateTarget =
    workflow.mode === "armed"
      ? workflow.activeTarget
      : workflow.mode === "dragging"
        ? workflow.target
        : null;
  const currentTarget = candidateTarget ? dom.targetFromElement(candidateTarget.element) : null;
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
        const output = dom.getTarget(selection.target)?.element;
        if (!output) return null;
        return (
          <SelectionMarker
            key={selection.id}
            selection={selection}
            output={output}
            viewportRevision={viewportRevision}
            current={selection.id === currentSelectionId}
            busy={busySelectionIds.has(selection.id)}
            capturing={selection.snapshot.status === "pending"}
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
