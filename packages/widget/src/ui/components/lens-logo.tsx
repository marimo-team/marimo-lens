import * as stylex from "@stylexjs/stylex";

import darkLogo from "../assets/marimo-lens-mark-dark.svg";
import lightLogo from "../assets/marimo-lens-mark-light.svg";
import { useLensTheme } from "../theme";
import { logoStyles } from "./lens-dock.styles";

export function LensLogo() {
  const theme = useLensTheme();
  return (
    <span {...stylex.props(logoStyles.root)} aria-hidden="true">
      <img
        {...stylex.props(logoStyles.image, theme === "dark" && logoStyles.hidden)}
        src={lightLogo}
        width={28}
        height={28}
        alt=""
        draggable={false}
      />
      <img
        {...stylex.props(logoStyles.image, theme === "light" && logoStyles.hidden)}
        src={darkLogo}
        width={28}
        height={28}
        alt=""
        draggable={false}
      />
    </span>
  );
}
