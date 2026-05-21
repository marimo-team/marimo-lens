import { useCallback, useEffect, useRef } from "react";

import type { RefreshState } from "@/types";

import { writeClipboard } from "@/lib/clipboard";
import { useLensUiStore } from "@/store";

type UseCopyFeedbackOptions = {
  contextRevision: number;
  feedbackText: string;
  onScan: (requestId?: string) => void;
  refreshState: RefreshState;
};

export function useCopyFeedback({
  contextRevision,
  feedbackText,
  onScan,
  refreshState,
}: UseCopyFeedbackOptions): () => void {
  const copyStatus = useLensUiStore((state) => state.copyStatus);
  const copyRequestId = useLensUiStore((state) => state.copyRequestId);
  const copyStartedRevision = useLensUiStore((state) => state.copyStartedRevision);
  const startCopy = useLensUiStore((state) => state.startCopy);
  const copySucceeded = useLensUiStore((state) => state.copySucceeded);
  const copyFailed = useLensUiStore((state) => state.copyFailed);
  const resetCopyStatus = useLensUiStore((state) => state.resetCopyStatus);
  const resetTimerRef = useRef<number | null>(null);

  const scheduleCopyStatusReset = useCallback(
    (revision: number) => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        resetCopyStatus(revision);
      }, 1200);
    },
    [resetCopyStatus],
  );

  const copyFeedbackText = useCallback(
    async (revision: number) => {
      if (!feedbackText) {
        copyFailed("No Lens feedback is available to copy after refresh.");
        return;
      }
      const didCopy = await writeClipboard(feedbackText);
      if (!didCopy) {
        copyFailed("Clipboard write failed.");
        return;
      }
      copySucceeded(revision);
      scheduleCopyStatusReset(revision);
    },
    [copyFailed, copySucceeded, feedbackText, scheduleCopyStatusReset],
  );

  const startCopyRefresh = useCallback(() => {
    if (copyStatus === "pending") return;
    const requestId = `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    startCopy(requestId, contextRevision);
    onScan(requestId);
  }, [contextRevision, copyStatus, onScan, startCopy]);

  useEffect(() => {
    if (copyRequestId === null || refreshState.requestId !== copyRequestId) {
      return;
    }
    if (refreshState.status === "error") {
      copyFailed(refreshState.error || "Lens context refresh failed.");
      return;
    }
    if (refreshState.status !== "success") {
      return;
    }
    const refreshedRevision = refreshState.pairPromptRevision ?? refreshState.contextRevision;
    if (refreshedRevision === undefined || refreshedRevision !== contextRevision) {
      return;
    }
    if (copyStartedRevision !== null && refreshedRevision <= copyStartedRevision) {
      copyFailed("Lens refresh did not produce a newer feedback artifact.");
      return;
    }
    void copyFeedbackText(refreshedRevision);
  }, [
    contextRevision,
    copyFailed,
    copyFeedbackText,
    copyRequestId,
    copyStartedRevision,
    feedbackText,
    refreshState.contextRevision,
    refreshState.error,
    refreshState.pairPromptRevision,
    refreshState.requestId,
    refreshState.status,
  ]);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  return startCopyRefresh;
}
