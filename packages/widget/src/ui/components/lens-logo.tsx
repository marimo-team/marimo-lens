import type { CSSProperties } from "react";

const darkMark = new URL(
  "../../../../../apps/docs/public/brand/marimo-lens-mark-dark.svg",
  import.meta.url,
).href;
const lightMark = new URL(
  "../../../../../apps/docs/public/brand/marimo-lens-mark-light.svg",
  import.meta.url,
).href;
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
