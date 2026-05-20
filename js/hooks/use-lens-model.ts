import { useCallback, useMemo } from "react";
import { useModelState } from "@anywidget/react";
import { normalizeLensTargets } from "@/selection/lens-targets";
import {
  EMPTY_GRAPH,
  type AgentActivity,
  type AgentCommand,
  type LensAnnotation,
  type LensTarget,
  type NotebookGraph,
  type PairResult,
} from "@/types";

const EMPTY_ANNOTATIONS: LensAnnotation[] = [];
const EMPTY_AGENT_ACTIVITY: AgentActivity[] = [];
const EMPTY_AGENT_COMMANDS: AgentCommand[] = [];

export function useLensModel() {
  const [title] = useModelState<string>("title");
  const [targets] = useModelState<LensTarget[]>("targets");
  const [notebook] = useModelState<NotebookGraph>("notebook");
  const [annotations, setAnnotations] = useModelState<LensAnnotation[]>("annotations");
  const [markdown] = useModelState<string>("markdown");
  const [pair_prompt] = useModelState<string>("pair_prompt");
  const [agentActivity] = useModelState<AgentActivity[]>("agent_activity");
  const [agentCommands] = useModelState<AgentCommand[]>("agent_commands");
  const [pairResult] = useModelState<PairResult>("pair_result");
  const [pairResultPrompt] = useModelState<string>("pair_result_prompt");
  const [lensCss] = useModelState<string>("_lens_css");
  const [, setRefreshRequest] = useModelState<number>("_refresh_request");
  const [contextRevision] = useModelState<number>("_context_revision");
  const normalizedTargets = useMemo(() => normalizeLensTargets(targets), [targets]);
  const graph = notebook ?? EMPTY_GRAPH;
  const currentAnnotations = annotations ?? EMPTY_ANNOTATIONS;

  const addAnnotation = useCallback(
    (draft: Omit<LensAnnotation, "id" | "createdAt">) => {
      const annotation: LensAnnotation = {
        ...draft,
        id: `ml-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      };
      setAnnotations((current) => [...(current ?? EMPTY_ANNOTATIONS), annotation]);
    },
    [setAnnotations],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      setAnnotations((current) =>
        (current ?? EMPTY_ANNOTATIONS).filter((annotation) => annotation.id !== id),
      );
    },
    [setAnnotations],
  );

  const clearAnnotations = useCallback(() => {
    setAnnotations([]);
  }, [setAnnotations]);
  const refreshContext = useCallback(() => {
    setRefreshRequest((current) => (current ?? 0) + 1);
  }, [setRefreshRequest]);

  return {
    title,
    targets: normalizedTargets,
    graph,
    annotations: currentAnnotations,
    markdown: markdown ?? "",
    pair_prompt: pair_prompt ?? "",
    agentActivity: agentActivity ?? EMPTY_AGENT_ACTIVITY,
    agentCommands: agentCommands ?? EMPTY_AGENT_COMMANDS,
    pairResult: pairResult ?? {},
    pairResultPrompt: pairResultPrompt ?? "",
    lensCss: lensCss ?? "",
    contextRevision: contextRevision ?? 0,
    refreshContext,
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
  };
}
