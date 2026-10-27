import type { Selection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";

import { useLens } from "@/context/lens-context";
import { historyKey } from "@/context/record-index";
import { useNow } from "@/ui/use-now";

import { earlierStyles } from "./earlier-requests.styles";
import { RequestChip, RequestSummary } from "./record-parts";

/**
 * The earlier requests whose changes reach a selection's cells or their
 * upstream, the same requests the agent's brief lists, with undone ones first.
 */
export function EarlierRequests({ selection }: { selection: Selection }) {
  const { state } = useLens();
  const now = useNow();
  const shaping = state.record.shaping(selection.id);
  if (shaping.length === 0) return null;
  return (
    <section
      {...stylex.props(earlierStyles.section)}
      aria-label={`Earlier requests that changed what ${selection.label} shows`}
      data-marimo-lens-earlier-requests
    >
      <h3 {...stylex.props(earlierStyles.title)}>Earlier requests that changed this result</h3>
      <ol {...stylex.props(earlierStyles.list)}>
        {shaping.map((entry) => (
          <li key={historyKey(entry.id, entry.resolvedAt)} {...stylex.props(earlierStyles.item)}>
            <RequestChip entry={entry} />
            <RequestSummary entry={entry} record={state.record} now={now} />
          </li>
        ))}
      </ol>
    </section>
  );
}
