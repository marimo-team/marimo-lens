import type { SelectionAnchor } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";

import { kindMarkStyles } from "./selection-kind-mark.styles";

export function SelectionKindMark({
  kind,
  push = false,
  noLeadingMargin = false,
}: {
  kind: SelectionAnchor["kind"];
  push?: boolean;
  noLeadingMargin?: boolean;
}) {
  const label = kind === "point" ? "Point selection" : "Region selection";
  return (
    <span
      {...stylex.props(
        kindMarkStyles.root,
        noLeadingMargin && kindMarkStyles.noLeadingMargin,
        push && kindMarkStyles.push,
      )}
      data-kind={kind}
      title={label}
    >
      {kind === "point" ? (
        <svg {...stylex.props(kindMarkStyles.svg)} viewBox="0 0 14 14">
          <title>{label}</title>
          <circle
            {...stylex.props(kindMarkStyles.outline, kindMarkStyles.boundary)}
            cx="7"
            cy="7"
            r="4.25"
          />
          <circle {...stylex.props(kindMarkStyles.solid)} cx="7" cy="7" r="2" />
        </svg>
      ) : (
        <svg {...stylex.props(kindMarkStyles.svg)} viewBox="0 0 14 14">
          <title>{label}</title>
          <rect {...stylex.props(kindMarkStyles.regionFill)} x="2" y="2.5" width="10" height="9" />
          <rect
            {...stylex.props(kindMarkStyles.outline)}
            x="2"
            y="2.5"
            width="10"
            height="9"
            rx="1"
          />
          <rect
            {...stylex.props(kindMarkStyles.solid)}
            x="1"
            y="1.5"
            width="3"
            height="3"
            rx="0.5"
          />
          <rect
            {...stylex.props(kindMarkStyles.solid)}
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
