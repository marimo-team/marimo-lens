import { IconCheck, IconCopy, IconCrosshair, IconScan, IconTrash } from "@/components/icons";
import { LensTooltip } from "@/components/lens-tooltip";

type LensActionsProps = {
  armed: boolean;
  copied: boolean;
  copying: boolean;
  disabled: boolean;
  onCopy: () => void;
  onScan: () => void;
  onClear: () => void;
  onToggleCapture: () => void;
};

export function LensActions({
  armed,
  copied,
  copying,
  disabled,
  onCopy,
  onScan,
  onClear,
  onToggleCapture,
}: LensActionsProps) {
  const captureTooltip = armed
    ? "Choose the notebook output your feedback belongs to."
    : "Select a result and leave a concrete request for marimo-pair.";
  const copyTooltip = copying
    ? "Updating the notebook snapshot before copying."
    : copied
      ? "The marimo-pair prompt is on the clipboard."
      : "Copy the current notebook context for marimo-pair.";
  return (
    <div className="ml-actions">
      <LensTooltip content={captureTooltip}>
        <button
          className={armed ? "ml-primary ml-primary--armed" : "ml-primary"}
          onClick={onToggleCapture}
          type="button"
          data-marimo-lens-tooltip={armed ? "Click a target" : "Give feedback"}
        >
          <IconCrosshair size={15} />
          <span>{armed ? "Click a target" : "Give feedback"}</span>
        </button>
      </LensTooltip>
      <LensTooltip content={copyTooltip}>
        <button
          className="ml-secondary"
          onClick={onCopy}
          type="button"
          disabled={disabled}
          data-marimo-lens-tooltip="Copy context"
        >
          {copying ? (
            <IconScan size={15} />
          ) : copied ? (
            <IconCheck size={15} />
          ) : (
            <IconCopy size={15} />
          )}
          <span>{copying ? "Refreshing" : copied ? "Copied" : "Copy context"}</span>
        </button>
      </LensTooltip>
      <LensTooltip content="Refresh Lens with the latest outputs, controls, and widget values.">
        <button
          className="ml-icon-button"
          onClick={onScan}
          type="button"
          aria-label="Scan context"
          data-marimo-lens-tooltip="Scan context"
        >
          <IconScan size={15} />
        </button>
      </LensTooltip>
      <LensTooltip content="Remove the feedback markers shown in this Lens panel.">
        <button
          className="ml-icon-button"
          onClick={onClear}
          type="button"
          disabled={disabled}
          aria-label="Clear feedback"
          data-marimo-lens-tooltip="Clear feedback"
        >
          <IconTrash size={15} />
        </button>
      </LensTooltip>
    </div>
  );
}
