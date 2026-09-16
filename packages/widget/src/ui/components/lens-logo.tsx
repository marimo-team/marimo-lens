import darkLogo from "../assets/marimo-lens-mark-dark.svg";
import lightLogo from "../assets/marimo-lens-mark-light.svg";

type LensLogoProps = {
  className?: string;
};

export function LensLogo({ className }: LensLogoProps) {
  return (
    <span className={className} aria-hidden="true">
      <img
        className="ml-dock-tab__logo-image ml-dock-tab__logo-image--light"
        src={lightLogo}
        width={30}
        height={30}
        alt=""
        draggable={false}
      />
      <img
        className="ml-dock-tab__logo-image ml-dock-tab__logo-image--dark"
        src={darkLogo}
        width={30}
        height={30}
        alt=""
        draggable={false}
      />
    </span>
  );
}
