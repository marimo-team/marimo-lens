import { CircleHelp, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { LensTooltip } from "@/components/lens-tooltip";
import {
  nextOutputDetailLevel,
  OUTPUT_DETAIL_OPTIONS,
  type OutputDetailLevel,
} from "@/feedback/output-detail";
import { useLensTheme } from "@/hooks/use-lens-theme";
import { useLensUiStore } from "@/store";

type LensSettingsPanelProps = {
  state: "open" | "closing";
};

export function LensSettingsPanel({ state }: LensSettingsPanelProps) {
  const outputDetail = useLensUiStore((store) => store.outputDetail);
  const setOutputDetail = useLensUiStore((store) => store.setOutputDetail);
  const setTheme = useLensUiStore((store) => store.setTheme);
  const theme = useLensTheme();
  const outputHelpId = useId();
  const activeOption =
    OUTPUT_DETAIL_OPTIONS.find((option) => option.value === outputDetail) ??
    OUTPUT_DETAIL_OPTIONS[1];
  const nextTheme = theme === "dark" ? "light" : "dark";
  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <section
      className="ml-settings-panel"
      data-state={state}
      data-marimo-lens-ui
      aria-label="Lens settings"
      aria-hidden={state === "closing" ? "true" : undefined}
      inert={state === "closing"}
    >
      <header className="ml-settings-panel__header">
        <div>
          <h2 className="ml-settings-panel__title">Settings</h2>
          <p className="ml-settings-panel__meta">Copy detail</p>
        </div>
        <button
          className="ml-theme-toggle"
          type="button"
          title={themeLabel}
          aria-label={themeLabel}
          aria-pressed={theme === "dark" ? "true" : "false"}
          onClick={() => setTheme(nextTheme)}
        >
          <span className="ml-theme-toggle__icon" key={theme} aria-hidden="true">
            {theme === "dark" ? (
              <Sun size={16} strokeWidth={1.9} />
            ) : (
              <Moon size={16} strokeWidth={1.9} />
            )}
          </span>
        </button>
      </header>

      <div className="ml-settings-panel__divider" />

      <div className="ml-settings-row">
        <div className="ml-settings-label">
          <span>Output</span>
          <HelpIcon content={activeOption.help} descriptionId={outputHelpId} />
        </div>
        <button
          className="ml-settings-cycle"
          type="button"
          onClick={() => setOutputDetail(nextOutputDetailLevel(outputDetail))}
          aria-label={`Output detail: ${activeOption.label}`}
          aria-describedby={outputHelpId}
        >
          <span key={outputDetail} className="ml-settings-cycle__label">
            {activeOption.label}
          </span>
          <span className="ml-settings-cycle__dots" aria-hidden="true">
            {OUTPUT_DETAIL_OPTIONS.map((option) => (
              <span
                key={option.value}
                className="ml-settings-cycle__dot"
                data-active={option.value === outputDetail ? "true" : "false"}
              />
            ))}
          </span>
        </button>
      </div>

      <div className="ml-settings-levels" aria-label="Output detail">
        {OUTPUT_DETAIL_OPTIONS.map((option) => (
          <DetailLevelButton
            key={option.value}
            option={option}
            selected={option.value === outputDetail}
            onSelect={setOutputDetail}
          />
        ))}
      </div>
    </section>
  );
}

function DetailLevelButton({
  option,
  selected,
  onSelect,
}: {
  option: (typeof OUTPUT_DETAIL_OPTIONS)[number];
  selected: boolean;
  onSelect: (value: OutputDetailLevel) => void;
}) {
  const helpId = useId();
  return (
    <button
      className="ml-settings-level"
      type="button"
      aria-pressed={selected ? "true" : "false"}
      aria-describedby={helpId}
      data-active={selected ? "true" : "false"}
      onClick={() => onSelect(option.value)}
    >
      <span>{option.label}</span>
      <HelpIcon content={option.help} descriptionId={helpId} />
    </button>
  );
}

function HelpIcon({ content, descriptionId }: { content: string; descriptionId: string }) {
  return (
    <LensTooltip content={content}>
      <span className="ml-help-icon" aria-hidden="true">
        <CircleHelp size={13} strokeWidth={1.8} />
      </span>
      <span id={descriptionId} className="ml-sr-only">
        {content}
      </span>
    </LensTooltip>
  );
}
