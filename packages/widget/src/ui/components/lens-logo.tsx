import type { CSSProperties } from "react";

import darkMark from "../../../../../apps/docs/public/brand/marimo-lens-mark-dark.svg";
import lightMark from "../../../../../apps/docs/public/brand/marimo-lens-mark-light.svg";

const markStyle = {
  "--ml-lens-mark-light": `url("${lightMark}")`,
  "--ml-lens-mark-dark": `url("${darkMark}")`,
} as CSSProperties;

type LensLogoProps = {
  className?: string;
};

export function LensLogo({ className }: LensLogoProps) {
  return <span className={className} style={markStyle} aria-hidden="true" />;
}
