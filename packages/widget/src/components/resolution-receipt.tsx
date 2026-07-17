import { Check } from "lucide-react";

import type { SelectionResolvedEvent } from "@/contracts";

export function ResolutionReceipt({ event }: { event: SelectionResolvedEvent }) {
  return (
    <div
      className="ml-resolution-receipt"
      data-marimo-lens-resolution-receipt
      data-selection-id={event.payload.selectionId}
      data-revision={event.revision}
      data-marimo-lens-ui
      aria-hidden="true"
    >
      <Check size={14} strokeWidth={2} aria-hidden="true" />
      <span className="ml-resolution-receipt__label">{event.payload.label}</span>
      <span className="ml-resolution-receipt__status">resolved</span>
      {event.payload.summary ? (
        <span className="ml-resolution-receipt__summary">{event.payload.summary}</span>
      ) : null}
    </div>
  );
}
