import { useModelState } from "@anywidget/react";
import { useCallback, useMemo } from "react";

import type { LensAnnotation } from "@/types";

import {
  normalizeAgentActivity,
  normalizeAgentCommands,
  normalizeLensAnnotations,
  normalizeLensTargets,
  normalizeNotebookGraph,
  normalizePairFeedback,
  normalizeRefreshState,
} from "@/contracts";

export function useLensModel() {
  const [title] = useModelState<string>("title");
  const [targets] = useModelState<unknown>("targets");
  const [notebook] = useModelState<unknown>("notebook");
  const [annotations, setAnnotations] = useModelState<LensAnnotation[]>("annotations");
  const [markdown] = useModelState<string>("markdown");
  const [pairFeedback] = useModelState<unknown>("pair_feedback");
  const [pair_prompt] = useModelState<string>("pair_prompt");
  const [agentActivity] = useModelState<unknown>("agent_activity");
  const [agentCommands] = useModelState<unknown>("agent_commands");
  const [lensCss] = useModelState<string>("_lens_css");
  const [, setRefreshRequest] = useModelState<number>("_refresh_request");
  const [, setRefreshRequestId] = useModelState<string>("_refresh_request_id");
  const [refreshState] = useModelState<unknown>("_refresh_state");
  const [contextRevision] = useModelState<number>("_context_revision");
  const normalizedTargets = useMemo(() => normalizeLensTargets(targets), [targets]);
  const graph = useMemo(() => normalizeNotebookGraph(notebook), [notebook]);
  const currentAnnotations = useMemo(() => normalizeLensAnnotations(annotations), [annotations]);
  const normalizedAgentActivity = useMemo(
    () => normalizeAgentActivity(agentActivity),
    [agentActivity],
  );
  const normalizedAgentCommands = useMemo(
    () => normalizeAgentCommands(agentCommands),
    [agentCommands],
  );
  const normalizedPairFeedback = useMemo(() => normalizePairFeedback(pairFeedback), [pairFeedback]);
  const normalizedRefreshState = useMemo(() => normalizeRefreshState(refreshState), [refreshState]);

  const addAnnotation = useCallback(
    (draft: Omit<LensAnnotation, "id" | "createdAt">) => {
      const annotation: LensAnnotation = {
        ...draft,
        id: `ml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      };
      setAnnotations((current) => [...normalizeLensAnnotations(current), annotation]);
    },
    [setAnnotations],
  );

  const clearAnnotations = useCallback(() => {
    setAnnotations([]);
  }, [setAnnotations]);
  const refreshContext = useCallback(
    (requestId?: string) => {
      if (requestId) {
        setRefreshRequestId(requestId);
        return;
      }
      setRefreshRequest((current) => (current ?? 0) + 1);
    },
    [setRefreshRequest, setRefreshRequestId],
  );

  return {
    title,
    targets: normalizedTargets,
    graph,
    annotations: currentAnnotations,
    markdown: markdown ?? "",
    pairFeedback: normalizedPairFeedback,
    pair_prompt: pair_prompt ?? "",
    agentActivity: normalizedAgentActivity,
    agentCommands: normalizedAgentCommands,
    lensCss: lensCss ?? "",
    contextRevision: contextRevision ?? 0,
    refreshState: normalizedRefreshState,
    refreshContext,
    addAnnotation,
    clearAnnotations,
  };
}
