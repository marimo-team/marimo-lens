import { IconSparkle } from "@/components/icons";
import { LensTooltip } from "@/components/lens-tooltip";
import type { useDraggableDock } from "@/hooks/use-draggable-dock";

export function LensLauncher({
  dragProps,
  open,
  onClick,
}: {
  dragProps: ReturnType<typeof useDraggableDock>["launcherDragProps"];
  open: boolean;
  onClick: () => void;
}) {
  const label = open ? "Collapse Lens" : "Open Lens";
  return (
    <LensTooltip content={`${label}. Drag Lens wherever it stays out of your way.`}>
      <button
        {...dragProps}
        className={open ? "ml-launcher ml-launcher--open" : "ml-launcher"}
        onClick={onClick}
        type="button"
        aria-label={label}
        data-marimo-lens-tooltip={label}
      >
        <span className="ml-launcher__spark">
          <IconSparkle size={13} />
        </span>
      </button>
    </LensTooltip>
  );
}
