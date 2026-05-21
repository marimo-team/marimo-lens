import {
  Check,
  ClipboardCopy,
  Crosshair,
  ScanLine,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

import { LensTooltip } from "@/components/lens-tooltip";

type LensActionsProps = {
  armed: boolean;
  copied: boolean;
  copying: boolean;
  copyError: string;
  interactive?: boolean;
  noteCount: number;
  settingsOpen: boolean;
  onCopy: () => void;
  onScan: () => void;
  onClear: () => void;
  onClose: () => void;
  onToggleSettings: () => void;
  onToggleCapture: () => void;
};

export function LensActions({
  armed,
  copied,
  copying,
  copyError,
  interactive = true,
  noteCount,
  settingsOpen,
  onCopy,
  onScan,
  onClear,
  onClose,
  onToggleSettings,
  onToggleCapture,
}: LensActionsProps) {
  const hasNotes = noteCount > 0;
  const copyUnavailable = copying || !hasNotes;
  const captureTooltip = armed
    ? "Choose the notebook output your feedback belongs to."
    : "Select a result and leave a concrete request for marimo-pair.";
  const copyPresentation = copyActionPresentation({
    copied,
    copyError,
    copying,
    hasNotes,
  });
  const feedbackDescriptionId = useId();
  const copyDescriptionId = useId();
  const exitDescriptionId = useId();
  const CopyIcon = copyPresentation.Icon;
  const secondaryActions: ActionSpec[] = [
    {
      Icon: ScanLine,
      ariaLabel: "Refresh context",
      description: "Refresh Lens with the latest outputs, controls, and widget values.",
      label: "Scan",
      onClick: onScan,
      shortcut: "R",
      tooltip: "Refresh context",
    },
    {
      Icon: Trash2,
      ariaDisabled: !hasNotes,
      ariaLabel: "Clear feedback",
      danger: true,
      description: "Remove saved feedback markers.",
      label: "Clear",
      onClick: onClear,
      prevent: !hasNotes,
      shortcut: "X",
      tooltip: "Clear feedback",
    },
    {
      Icon: Settings,
      ariaExpanded: settingsOpen,
      ariaLabel: settingsOpen ? "Close Lens settings" : "Open Lens settings",
      ariaPressed: settingsOpen,
      description: "Choose how much detail copied output includes.",
      label: "Settings",
      onClick: onToggleSettings,
      tooltip: "Settings",
    },
  ];
  return (
    <div className="ml-actions" aria-label="Lens actions">
      <LensTooltip content={<ActionHint label="Feedback" description={captureTooltip} />}>
        <button
          className="ml-action-button ml-action-button--primary"
          onClick={onToggleCapture}
          type="button"
          aria-label={armed ? "Cancel target selection" : "Give feedback"}
          aria-describedby={feedbackDescriptionId}
          data-active={armed ? "true" : "false"}
          data-marimo-lens-tooltip={armed ? "Click a target" : "Give feedback"}
          tabIndex={interactive ? undefined : -1}
        >
          <Crosshair size={16} strokeWidth={1.8} />
          {hasNotes ? <span className="ml-toolbar-badge">{noteCount}</span> : null}
          <ActionDescription id={feedbackDescriptionId} description={captureTooltip} />
        </button>
      </LensTooltip>
      <LensTooltip
        content={<ActionHint label="Copy" shortcut="C" description={copyPresentation.tooltip} />}
      >
        <button
          className="ml-action-button"
          onClick={(event) => {
            if (copyUnavailable) {
              event.preventDefault();
              return;
            }
            onCopy();
          }}
          type="button"
          aria-label={copyPresentation.ariaLabel}
          aria-busy={copying ? "true" : undefined}
          aria-describedby={copyDescriptionId}
          aria-disabled={copyUnavailable ? "true" : undefined}
          data-state={copyPresentation.state}
          data-marimo-lens-tooltip="Copy feedback"
          tabIndex={interactive ? undefined : -1}
        >
          <CopyIcon size={16} strokeWidth={1.8} />
          <ActionDescription
            id={copyDescriptionId}
            shortcut="C"
            description={copyPresentation.tooltip}
          />
        </button>
      </LensTooltip>
      {secondaryActions.map((action) => (
        <ActionButton key={action.label} action={action} interactive={interactive} />
      ))}
      <span className="ml-toolbar-divider" aria-hidden="true" />
      <LensTooltip
        content={<ActionHint label="Exit" shortcut="Esc" description="Collapse Lens." />}
      >
        <button
          className="ml-action-button"
          onClick={onClose}
          type="button"
          aria-label="Collapse Lens"
          aria-describedby={exitDescriptionId}
          tabIndex={interactive ? undefined : -1}
        >
          <X size={17} strokeWidth={1.8} />
          <ActionDescription id={exitDescriptionId} shortcut="Esc" description="Collapse Lens." />
        </button>
      </LensTooltip>
    </div>
  );
}

type ActionSpec = {
  Icon: LucideIcon;
  ariaDisabled?: boolean;
  ariaExpanded?: boolean;
  ariaLabel: string;
  ariaPressed?: boolean;
  danger?: boolean;
  description: string;
  label: string;
  onClick: () => void;
  prevent?: boolean;
  shortcut?: string;
  tooltip: string;
};

function ActionButton({ action, interactive }: { action: ActionSpec; interactive: boolean }) {
  const Icon = action.Icon;
  const descriptionId = useId();
  return (
    <LensTooltip
      content={
        <ActionHint
          label={action.label}
          shortcut={action.shortcut}
          description={action.description}
        />
      }
    >
      <button
        className="ml-action-button"
        onClick={(event) => {
          if (action.prevent) {
            event.preventDefault();
            return;
          }
          action.onClick();
        }}
        type="button"
        aria-label={action.ariaLabel}
        aria-describedby={descriptionId}
        aria-disabled={action.ariaDisabled ? "true" : undefined}
        aria-expanded={action.ariaExpanded}
        aria-pressed={action.ariaPressed}
        data-danger={action.danger ? "true" : undefined}
        data-marimo-lens-tooltip={action.tooltip}
        tabIndex={interactive ? undefined : -1}
      >
        <Icon size={16} strokeWidth={1.8} />
        <ActionDescription
          id={descriptionId}
          shortcut={action.shortcut}
          description={action.description}
        />
      </button>
    </LensTooltip>
  );
}

function copyActionPresentation({
  copied,
  copyError,
  copying,
  hasNotes,
}: {
  copied: boolean;
  copyError: string;
  copying: boolean;
  hasNotes: boolean;
}): {
  Icon: LucideIcon;
  ariaLabel: string;
  state?: string;
  tooltip: string;
} {
  if (copying) {
    return {
      Icon: ScanLine,
      ariaLabel: "Refreshing context",
      state: "busy",
      tooltip: "Updating the notebook snapshot before copying.",
    };
  }
  if (copied) {
    return {
      Icon: Check,
      ariaLabel: "Copied feedback",
      state: "success",
      tooltip: "The marimo-pair prompt is on the clipboard.",
    };
  }
  if (copyError && hasNotes) {
    return { Icon: X, ariaLabel: "Copy failed", state: "error", tooltip: copyError };
  }
  return {
    Icon: ClipboardCopy,
    ariaLabel: "Copy feedback",
    tooltip: hasNotes
      ? "Copy the saved feedback and fresh notebook context for marimo-pair."
      : "Add feedback before copying the agent prompt.",
  };
}

function ActionHint({
  label,
  shortcut,
  description,
}: {
  label: string;
  shortcut?: string;
  description?: string;
}) {
  return (
    <span className="ml-action-hint">
      <span className="ml-action-hint__top">
        <span>{label}</span>
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
      {description ? <span className="ml-action-hint__description">{description}</span> : null}
    </span>
  );
}

function ActionDescription({
  id,
  shortcut,
  description,
}: {
  id: string;
  shortcut?: string;
  description: string;
}) {
  const shortcutText = shortcut ? ` Shortcut: ${shortcut}.` : "";
  return (
    <span id={id} className="ml-sr-only">
      {description}
      {shortcutText}
    </span>
  );
}
