import { useCallback, useEffect, useState } from "react";
import { LensLauncher } from "@/components/dock-buttons";
import { LensPanel } from "@/components/lens-panel";
import { useDraggableDock } from "@/hooks/use-draggable-dock";
import { writeClipboard } from "@/lib/clipboard";
import { hoverForTargetSelection, targetElementForSelection } from "@/selection/selection-registry";
import { useLensUiStore } from "@/store";
import type { AgentActivity, LensAnnotation, LensTarget, NotebookGraph } from "@/types";

type LensDockProps = {
  title?: string;
  targets: LensTarget[];
  graph: NotebookGraph;
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  markdown: string;
  pair_prompt: string;
  contextRevision: number;
  onScan: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
};

export function LensDock({
  title,
  targets,
  graph,
  annotations,
  agentActivity,
  markdown,
  pair_prompt,
  contextRevision,
  onScan,
  onClear,
  onRemove,
}: LensDockProps) {
  const open = useLensUiStore((state) => state.open);
  const armed = useLensUiStore((state) => state.armed);
  const copied = useLensUiStore((state) => state.copied);
  const dragging = useLensUiStore((state) => state.dragging);
  const popupOpen = useLensUiStore((state) => state.popup !== null);
  const toggleOpen = useLensUiStore((state) => state.toggleOpen);
  const startCapture = useLensUiStore((state) => state.startCapture);
  const stopCapture = useLensUiStore((state) => state.stopCapture);
  const setHover = useLensUiStore((state) => state.setHover);
  const setCopied = useLensUiStore((state) => state.setCopied);
  const { consumeDragClick, dockRef, dockStyle, launcherDragProps } = useDraggableDock();
  const [pendingCopyRevision, setPendingCopyRevision] = useState<number | null>(null);
  const feedbackText = pair_prompt || markdown;

  const copyFeedbackText = useCallback(async () => {
    const text = feedbackText;
    if (!text) return;
    const didCopy = await writeClipboard(text);
    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }, [feedbackText, setCopied]);

  const copyPairFeedback = useCallback(() => {
    if (pendingCopyRevision !== null) return;
    setPendingCopyRevision(contextRevision);
    onScan();
  }, [contextRevision, onScan, pendingCopyRevision]);

  useEffect(() => {
    if (pendingCopyRevision === null || contextRevision <= pendingCopyRevision) return;
    setPendingCopyRevision(null);
    void copyFeedbackText();
  }, [contextRevision, copyFeedbackText, pendingCopyRevision]);

  const onLauncherClick = useCallback(() => {
    if (consumeDragClick()) return;
    toggleOpen();
  }, [consumeDragClick, toggleOpen]);

  return (
    <div
      ref={dockRef}
      className="ml-dock"
      style={dockStyle}
      data-marimo-lens-ui
      data-open={open ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-positioned={dockStyle ? "true" : "false"}
      data-popup-open={popupOpen ? "true" : "false"}
    >
      <LensLauncher dragProps={launcherDragProps} open={open} onClick={onLauncherClick} />
      {open ? (
        <LensPanel
          title={title}
          targets={targets}
          graph={graph}
          annotations={annotations}
          agentActivity={agentActivity}
          armed={armed}
          copied={copied}
          copying={pendingCopyRevision !== null}
          onCopy={copyPairFeedback}
          onScan={onScan}
          onClear={onClear}
          onRemove={onRemove}
          onTargetEnter={(target) => {
            const element = targetElementForSelection(target, targets);
            setHover(element ? hoverForTargetSelection(target, element, targets) : null);
          }}
          onTargetLeave={() => setHover(null)}
          onToggleCapture={() => {
            if (armed) {
              stopCapture();
              setHover(null);
            } else {
              startCapture();
            }
          }}
        />
      ) : null}
    </div>
  );
}
