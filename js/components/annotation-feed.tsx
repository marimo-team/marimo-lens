import { LensTooltip } from "@/components/lens-tooltip";
import {
  annotationStatusById,
  annotationStatusLabel,
  visibleAnnotations,
} from "@/lib/agent-activity";
import type { AgentActivity, LensAnnotation } from "@/types";

export function AnnotationFeed({
  annotations,
  agentActivity,
  onRemove,
}: {
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  onRemove: (id: string) => void;
}) {
  const statuses = annotationStatusById(agentActivity);
  const activeAnnotations = visibleAnnotations(annotations, agentActivity);
  return (
    <div className="ml-feed">
      {activeAnnotations.slice(-3).map((annotation) => {
        const receipt = statuses.get(annotation.id);
        return (
          <div className="ml-feed-item" key={annotation.id} data-agent-status={receipt?.status}>
            <div>
              <strong>{annotation.variable || annotation.targetLabel}</strong>
              <span>{annotation.column || annotation.kind}</span>
            </div>
            {receipt ? (
              <span className="ml-feed-status">{annotationStatusLabel(receipt.status)}</span>
            ) : null}
            <LensTooltip content="Remove this saved feedback note.">
              <button
                className="ml-feed-remove"
                onClick={() => onRemove(annotation.id)}
                type="button"
                data-marimo-lens-tooltip="Remove feedback"
              >
                remove
              </button>
            </LensTooltip>
          </div>
        );
      })}
    </div>
  );
}
