import type { SelectionAnchor } from "@marimo-lens/protocol";

export function SelectionKindMark({ kind }: { kind: SelectionAnchor["kind"] }) {
  const label = kind === "point" ? "Point selection" : "Region selection";
  return (
    <span className="ml-selection-kind-mark" data-kind={kind} title={label}>
      {kind === "point" ? (
        <svg viewBox="0 0 14 14">
          <title>{label}</title>
          <circle className="ml-selection-kind-mark__boundary" cx="7" cy="7" r="4.25" />
          <circle className="ml-selection-kind-mark__point" cx="7" cy="7" r="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 14 14">
          <title>{label}</title>
          <rect
            className="ml-selection-kind-mark__region-fill"
            x="2"
            y="2.5"
            width="10"
            height="9"
          />
          <rect
            className="ml-selection-kind-mark__region"
            x="2"
            y="2.5"
            width="10"
            height="9"
            rx="1"
          />
          <rect
            className="ml-selection-kind-mark__handle"
            x="1"
            y="1.5"
            width="3"
            height="3"
            rx="0.5"
          />
          <rect
            className="ml-selection-kind-mark__handle"
            x="10"
            y="9.5"
            width="3"
            height="3"
            rx="0.5"
          />
        </svg>
      )}
    </span>
  );
}
