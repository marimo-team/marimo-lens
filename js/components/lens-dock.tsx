import { useCallback, useEffect, useEffectEvent, useState } from "react";

import type {
  AgentActivity,
  LensAnnotation,
  LensTarget,
  NotebookGraph,
  PairFeedback,
  RefreshState,
} from "@/types";

import { LensInspectorPanel } from "@/components/lens-inspector-panel";
import { LensSettingsPanel } from "@/components/lens-settings-panel";
import { LensToolbar } from "@/components/lens-toolbar";
import { renderPairPromptForDetail } from "@/feedback/output-detail";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { useDraggableDock } from "@/hooks/use-draggable-dock";
import { visibleAnnotations } from "@/lib/agent-activity";
import { isEditableKeyboardEvent } from "@/lib/editable-event";
import { hoverForTargetSelection, targetElementForSelection } from "@/selection/selection-registry";
import { useLensUiStore } from "@/store";

const INSPECTOR_EXIT_MS = 220;
const SETTINGS_EXIT_MS = 160;

type LensDockProps = {
  title?: string;
  targets: LensTarget[];
  graph: NotebookGraph;
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  markdown: string;
  pairFeedback: PairFeedback | null;
  pair_prompt: string;
  contextRevision: number;
  refreshState: RefreshState;
  onScan: (requestId?: string) => void;
  onClear: () => void;
};

export function LensDock({
  title,
  targets,
  graph,
  annotations,
  agentActivity,
  markdown,
  pairFeedback,
  pair_prompt,
  contextRevision,
  refreshState,
  onScan,
  onClear,
}: LensDockProps) {
  const open = useLensUiStore((state) => state.open);
  const armed = useLensUiStore((state) => state.armed);
  const copied = useLensUiStore((state) => state.copied);
  const copyStatus = useLensUiStore((state) => state.copyStatus);
  const copyError = useLensUiStore((state) => state.copyError);
  const dragging = useLensUiStore((state) => state.dragging);
  const settingsOpen = useLensUiStore((state) => state.settingsOpen);
  const outputDetail = useLensUiStore((state) => state.outputDetail);
  const popupOpen = useLensUiStore((state) => state.popup !== null);
  const toggleOpen = useLensUiStore((state) => state.toggleOpen);
  const toggleSettings = useLensUiStore((state) => state.toggleSettings);
  const setSettingsOpen = useLensUiStore((state) => state.setSettingsOpen);
  const startCapture = useLensUiStore((state) => state.startCapture);
  const stopCapture = useLensUiStore((state) => state.stopCapture);
  const setHover = useLensUiStore((state) => state.setHover);
  const { consumeDragClick, dockDragProps, dockRef, dockStyle } = useDraggableDock();
  const feedbackText = renderPairPromptForDetail(pairFeedback, outputDetail, pair_prompt, markdown);
  const noteCount = visibleAnnotations(annotations, agentActivity).length;
  const toolbarOpen = open && !popupOpen;
  const inspectorPresent = useInspectorPresence(toolbarOpen && !settingsOpen);
  const settingsPresent = useSettingsPresence(settingsOpen && toolbarOpen);

  const showTargetPreview = useCallback(
    (target: LensTarget) => {
      const element = targetElementForSelection(target, targets);
      setHover(element ? hoverForTargetSelection(target, element, targets) : null);
    },
    [setHover, targets],
  );

  const copyPairFeedback = useCopyFeedback({
    contextRevision,
    feedbackText,
    onScan,
    refreshState,
  });

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "escape") {
      if (isTextEntryKeyboardEvent(event)) return;
      if (settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (armed) {
        event.preventDefault();
        stopCapture();
        setHover(null);
        return;
      }
      if (toolbarOpen) {
        event.preventDefault();
        toggleOpen();
      }
      return;
    }

    if (isEditableKeyboardEvent(event)) return;

    if (!toolbarOpen || popupOpen || settingsOpen) return;

    const command = shortcutCommand(key, {
      canCopy: noteCount > 0 && copyStatus !== "pending",
      canClear: noteCount > 0,
      copyPairFeedback,
      onClear,
      onScan,
    });
    if (command) {
      event.preventDefault();
      command();
    }
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleShortcut(event);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      {inspectorPresent ? (
        <LensInspectorPanel
          title={title}
          state={toolbarOpen && !settingsOpen ? "open" : "closing"}
          targets={targets}
          graph={graph}
          annotations={annotations}
          agentActivity={agentActivity}
          onTargetEnter={showTargetPreview}
          onTargetLeave={() => setHover(null)}
        />
      ) : null}
      {settingsPresent ? (
        <LensSettingsPanel state={settingsOpen && toolbarOpen ? "open" : "closing"} />
      ) : null}
      <LensToolbar
        title={title}
        open={toolbarOpen}
        armed={armed}
        copied={copied}
        copying={copyStatus === "pending"}
        copyError={copyError}
        dragging={dragging}
        noteCount={noteCount}
        settingsOpen={settingsOpen}
        dragProps={dockDragProps}
        consumeDragClick={consumeDragClick}
        onCopy={copyPairFeedback}
        onScan={() => onScan()}
        onClear={onClear}
        onToggleSettings={toggleSettings}
        onToggleOpen={toggleOpen}
        onToggleCapture={() => {
          if (armed) {
            stopCapture();
            setHover(null);
          } else {
            startCapture();
          }
        }}
      />
    </div>
  );
}

function useInspectorPresence(open: boolean): boolean {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPresent(false), INSPECTOR_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return present;
}

function useSettingsPresence(open: boolean): boolean {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPresent(false), SETTINGS_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return present;
}

function shortcutCommand(
  key: string,
  actions: {
    canClear: boolean;
    canCopy: boolean;
    copyPairFeedback: () => void;
    onClear: () => void;
    onScan: () => void;
  },
): (() => void) | null {
  const commands: Record<string, (() => void) | null> = {
    c: actions.canCopy ? actions.copyPairFeedback : null,
    r: actions.onScan,
    x: actions.canClear ? actions.onClear : null,
  };
  return commands[key] ?? null;
}

function isTextEntryKeyboardEvent(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  return path.some((target) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag !== "input") return false;
    const type = target.getAttribute("type")?.toLowerCase() ?? "text";
    return !["button", "checkbox", "radio", "range", "reset", "submit"].includes(type);
  });
}
