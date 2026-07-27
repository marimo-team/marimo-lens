import darkLogo from "../../../../../apps/docs/public/brand/marimo-logo-dark.svg";
import lightLogo from "../../../../../apps/docs/public/brand/marimo-logo-light.svg";

type LensLogoProps = {
  className?: string;
};

export function LensLogo({ className }: LensLogoProps) {
  return (
    <span className={className} aria-hidden="true">
      <img
        className="ml-dock-tab__logo-image ml-dock-tab__logo-image--light"
        src={lightLogo}
        width={26}
        height={26}
        alt=""
        draggable={false}
      />
      <img
        className="ml-dock-tab__logo-image ml-dock-tab__logo-image--dark"
        src={darkLogo}
        width={26}
        height={26}
        alt=""
        draggable={false}
      />
    </span>
  );
}
