import * as stylex from "@stylexjs/stylex";

import darkLogo from "../assets/marimo-lens-mark-dark.svg";
import lightLogo from "../assets/marimo-lens-mark-light.svg";
import { useLensTheme } from "../theme";
import { logoStyles } from "./lens-dock.styles";

export function LensLogo() {
  const theme = useLensTheme();
  return (
    <img
      {...stylex.props(logoStyles.image)}
      src={theme === "dark" ? darkLogo : lightLogo}
      width={28}
      height={28}
      alt=""
      draggable={false}
    />
  );
}
