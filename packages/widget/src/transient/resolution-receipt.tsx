import type { SelectionResolvedEvent } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

import { transientStyles } from "./transient.styles";

export function ResolutionReceipt({
  event,
  onOpenHistory,
  onInteractionChange,
}: {
  event: SelectionResolvedEvent;
  onOpenHistory: (event: SelectionResolvedEvent) => void;
  onInteractionChange?: (event: SelectionResolvedEvent, active: boolean) => void;
}) {
  const { selections } = event.payload;
  const label = selections.length === 1 ? selections[0]!.label : `${selections.length} selections`;
  const interaction = useRef({ focused: false, hovered: false });
  const updateInteraction = (kind: "focused" | "hovered", active: boolean) => {
    interaction.current[kind] = active;
    onInteractionChange?.(event, interaction.current.focused || interaction.current.hovered);
  };
  useEffect(
    () => () => {
      onInteractionChange?.(event, false);
    },
    [event, onInteractionChange],
  );

  return (
    <button
      {...stylex.props(transientStyles.notification, transientStyles.receipt)}
      type="button"
      data-marimo-lens-resolution-receipt
      data-selection-id={selections.length === 1 ? selections[0]!.selectionId : undefined}
      data-selection-count={selections.length}
      data-revision={event.revision}
      data-marimo-lens-ui
      onClick={() => onOpenHistory(event)}
      onPointerEnter={() => updateInteraction("hovered", true)}
      onPointerLeave={() => updateInteraction("hovered", false)}
      onFocus={() => updateInteraction("focused", true)}
      onBlur={() => updateInteraction("focused", false)}
      aria-label={`Open history for ${label}`}
    >
      <Check
        {...stylex.props(transientStyles.notificationIcon, transientStyles.receiptIcon)}
        size={14}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span {...stylex.props(transientStyles.receiptLabel)}>{label}</span>
      <span {...stylex.props(transientStyles.receiptStatus)}>Addressed</span>
      {event.payload.summary ? (
        <span {...stylex.props(transientStyles.receiptSummary)}>{event.payload.summary}</span>
      ) : null}
    </button>
  );
}
