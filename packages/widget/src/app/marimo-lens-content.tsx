import { useCallback, useState } from "react";

import type { TargetAttentionPresentation } from "@/transient/target-attention";

import {
  defaultDependencies,
  useLensController,
  type LensDependencies,
} from "@/app/use-lens-controller";
import { LensContext } from "@/context/lens-context";
import { LensDock } from "@/dock/lens-dock";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";
import { SelectionOverlay } from "@/selection/components/selection-overlay";
import {
  TargetAttentionAnnouncement,
  TargetAttentionFallback,
  TargetAttentionIndicator,
  projectTargetAttentionSurface,
} from "@/transient/target-attention-indicator";
import { TrailControls } from "@/transient/trail-controls";
import { LensPortal } from "@/ui/components/lens-portal";
import { LensStatus } from "@/ui/components/lens-status";
import { focusSelectionOrDock } from "@/ui/focus";

export function MarimoLensContent({
  dependencies = defaultDependencies,
}: {
  dependencies?: LensDependencies;
}) {
  const lens = useLensController(dependencies);
  const { state } = lens.context;
  const { presentation } = lens;
  const surface = useAttentionSurface(presentation, lens.dom.window);
  const trailControls =
    presentation?.trail && !state.sheet.open && !lens.note ? (
      <TrailControls trail={presentation.trail} />
    ) : null;
  const { selectionActions, dispatch, note } = lens;

  return (
    <LensContext value={lens.context}>
      <LensPortal css={lens.css}>
        <LensDock
          notice={
            surface.fallback ? (
              <TargetAttentionFallback {...surface.fallback} controls={trailControls} />
            ) : null
          }
        />

        <SelectionOverlay
          selections={state.selections}
          currentSelectionId={state.currentSelectionId}
          workflow={lens.ui.workflow}
          busySelectionIds={state.busySelectionIds}
          registerAdjustment={lens.adjustment.registerAdjustment}
          releaseAdjustment={lens.adjustment.releaseAdjustment}
          onActivate={(selection) => selectionActions.activateSelection(selection.id)}
          onEditNote={(selection, motion) => selectionActions.openNote(selection.id, motion)}
          onReposition={selectionActions.repositionSelection}
        />

        <TargetAttentionIndicator
          view={surface.view}
          onLabelMeasure={surface.measureLabel}
          controls={trailControls}
        />

        {note ? (
          <SelectionNoteEditor
            key={`${note.selection.id}:${note.selection.note}`}
            selection={note.selection}
            saving={state.busySelectionIds.has(note.selection.id)}
            mutationPending={state.busySelectionIds.has(note.selection.id) || state.clearPending}
            motion={note.motion}
            saveError={note.error}
            onSave={(text) => selectionActions.saveNote(note.selection.id, text)}
            onCancel={() => {
              dispatch({ type: "closeNote" });
              focusSelectionOrDock(lens.dom, note.selection.id);
            }}
            onDelete={() => selectionActions.deleteSelection(note.selection)}
          />
        ) : null}

        <LensStatus message={lens.ui.announcement} />
        <TargetAttentionAnnouncement presentation={presentation} />
      </LensPortal>
    </LensContext>
  );
}

/**
 * Place target attention beside its target, or in the dock when the label
 * does not fit. The label reports its measured size once it renders.
 */
function useAttentionSurface(
  presentation: TargetAttentionPresentation | null,
  ownerWindow: Window,
) {
  const [label, setLabel] = useState<{
    sequence: number;
    height: number;
    maxWidth: number;
  } | null>(null);
  const measureLabel = useCallback(
    (sequence: number, measurement: { height: number; maxWidth: number }) => {
      setLabel((current) =>
        current?.sequence === sequence &&
        current.height === measurement.height &&
        current.maxWidth === measurement.maxWidth
          ? current
          : { sequence, ...measurement },
      );
    },
    [],
  );
  const surface = projectTargetAttentionSurface(
    presentation,
    ownerWindow,
    label !== null && label.sequence === presentation?.sequence ? label : undefined,
  );
  return { ...surface, measureLabel };
}
