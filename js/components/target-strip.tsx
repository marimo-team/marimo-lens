import type { LensTarget } from "@/types";

type TargetStripProps = {
  targets: LensTarget[];
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
};

export function TargetStrip({ targets, onTargetEnter, onTargetLeave }: TargetStripProps) {
  const primaryTargets = targets.filter((target) => target.kind !== "output");
  const outputTargets = targets.filter((target) => target.kind === "output").toSorted(outputRank);
  return (
    <div className="ml-target-strip" data-has-outputs={outputTargets.length > 0 ? "true" : "false"}>
      {primaryTargets.map((target) => (
        <TargetPill
          key={target.id}
          target={target}
          onTargetEnter={onTargetEnter}
          onTargetLeave={onTargetLeave}
        />
      ))}
      {outputTargets.length > 0 ? (
        <details className="ml-output-targets">
          <summary>{formatCount(outputTargets.length, "output")}</summary>
          <div className="ml-output-targets__items">
            {outputTargets.map((target) => (
              <TargetPill
                key={target.id}
                target={target}
                onTargetEnter={onTargetEnter}
                onTargetLeave={onTargetLeave}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

type TargetPillProps = {
  target: LensTarget;
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
};

function TargetPill({ target, onTargetEnter, onTargetLeave }: TargetPillProps) {
  const tooltip = targetTooltip(target);
  return (
    <button
      type="button"
      className="ml-target-pill"
      onFocus={() => onTargetEnter(target)}
      onBlur={onTargetLeave}
      onPointerEnter={() => onTargetEnter(target)}
      onPointerOver={() => onTargetEnter(target)}
      onPointerLeave={onTargetLeave}
      aria-label={tooltip}
    >
      <span data-kind={target.kind} />
      {target.label}
    </button>
  );
}

function targetTooltip(target: LensTarget): string {
  const label = target.variable || target.label;
  const shape = shapeText(target);
  const suffix = shape ? ` It has ${shape}.` : "";
  if (target.kind === "dataframe" || target.kind === "table") {
    return `Preview the data table ${label}.${suffix}`;
  }
  if (target.kind === "visualization") {
    return `Preview the chart output ${label}.${suffix}`;
  }
  if (target.kind === "anywidget") {
    return `Preview the interactive widget ${label}.${suffix}`;
  }
  if (target.kind === "ui") return `Preview the notebook control ${label}.`;
  if (target.kind === "media") return `Preview the media output ${label}.`;
  if (target.kind === "document") return `Preview the document output ${label}.`;
  if (target.kind === "output") return `Preview the rendered cell output ${label}.`;
  return `Preview ${label} in the notebook.`;
}

function outputRank(left: LensTarget, right: LensTarget): number {
  const difference = outputPriority(left) - outputPriority(right);
  if (difference !== 0) return difference;
  return left.label.localeCompare(right.label);
}

function outputPriority(target: LensTarget): number {
  if (target.output?.kind === "visualization" || target.capabilities?.chartPart) return 0;
  if (target.output?.kind === "dataframe" || target.output?.kind === "table") return 1;
  if (target.columns?.length) return 1;
  if (target.output?.kind === "media" || target.output?.kind === "document") return 2;
  return 3;
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function shapeText(target: LensTarget): string {
  const rows = target.shape?.rows;
  const columns = target.shape?.columns;
  if (typeof rows === "number" && typeof columns === "number") {
    return `${rows.toLocaleString()} rows and ${columns.toLocaleString()} columns`;
  }
  if (typeof rows === "number") return `${rows.toLocaleString()} rows`;
  return "";
}
