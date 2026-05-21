import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { LensColumn } from "@/types";

const CHIP_GAP_PX = 4;
const NAV_BUTTON_WIDTH_PX = 16;
const NAV_GAP_PX = 4;

type TargetColumnPagerProps = {
  columns: LensColumn[];
  onSelect: () => void;
  targetLabel: string;
};

type ColumnPagerLayout = {
  availableWidth: number;
  chipWidths: number[];
};

type ColumnStep = "previous" | "next";

const COLUMN_STEP_PRESENTATION = {
  next: {
    Icon: ChevronRight,
    label: (targetLabel: string) => `Show next columns for ${targetLabel}`,
  },
  previous: {
    Icon: ChevronLeft,
    label: (targetLabel: string) => `Show previous columns for ${targetLabel}`,
  },
} satisfies Record<ColumnStep, { Icon: LucideIcon; label: (targetLabel: string) => string }>;

export type ColumnWindowInput = {
  availableWidth: number;
  chipGap?: number;
  chipWidths: number[];
  navButtonWidth?: number;
  navGap?: number;
  requestedStartIndex: number;
};

export type ColumnWindow = {
  endIndex: number;
  hasNext: boolean;
  hasPrevious: boolean;
  overflowing: boolean;
  startIndex: number;
};

export const TargetColumnPager = memo(function TargetColumnPager({
  columns,
  onSelect,
  targetLabel,
}: TargetColumnPagerProps) {
  const visibleColumns = useMemo(() => {
    return columns.filter((column) => column.name.trim().length > 0);
  }, [columns]);
  const [startIndex, setStartIndex] = useState(0);
  const [step, setStep] = useState<ColumnStep>("next");
  const { layout, measureRef, rootRef } = useColumnPagerLayout(visibleColumns);
  const columnKey = useMemo(() => {
    return visibleColumns.map((column) => column.name).join("\u0000");
  }, [visibleColumns]);
  const window = useMemo(() => {
    return resolveColumnWindow({
      availableWidth: layout.availableWidth,
      chipWidths: layout.chipWidths,
      requestedStartIndex: startIndex,
    });
  }, [layout.availableWidth, layout.chipWidths, startIndex]);
  const pageColumns = visibleColumns.slice(window.startIndex, window.endIndex);

  useEffect(() => {
    setStartIndex(0);
  }, [columnKey]);

  useEffect(() => {
    if (startIndex !== window.startIndex) {
      setStartIndex(window.startIndex);
    }
  }, [startIndex, window.startIndex]);

  const handleStep = useCallback(
    (nextStep: ColumnStep) => {
      setStep(nextStep);
      setStartIndex((current) => {
        const nextIndex = nextStep === "next" ? current + 1 : current - 1;
        return clamp(nextIndex, 0, Math.max(visibleColumns.length - 1, 0));
      });
    },
    [visibleColumns.length],
  );

  if (visibleColumns.length === 0) return null;

  return (
    <span
      className="ml-target-column-pager"
      data-overflowing={window.overflowing ? "true" : "false"}
      ref={rootRef}
    >
      {window.overflowing ? (
        <ColumnStepButton
          step="previous"
          disabled={!window.hasPrevious}
          targetLabel={targetLabel}
          onStep={handleStep}
        />
      ) : null}
      <button
        type="button"
        className="ml-target-column-pager__viewport"
        aria-label={`Select ${targetLabel} from visible columns`}
        onClick={onSelect}
      >
        <span
          key={`${window.startIndex}:${window.endIndex}`}
          className="ml-target-column-pager__track"
          data-step={step}
        >
          {pageColumns.map((column, index) => (
            <ColumnChip key={`${column.name}:${window.startIndex + index}`} column={column} />
          ))}
        </span>
      </button>
      {window.overflowing ? (
        <ColumnStepButton
          step="next"
          disabled={!window.hasNext}
          targetLabel={targetLabel}
          onStep={handleStep}
        />
      ) : null}
      <span className="ml-target-column-pager__measure" ref={measureRef} aria-hidden="true">
        {visibleColumns.map((column, index) => (
          <ColumnChip key={`${column.name}:${index}`} column={column} />
        ))}
      </span>
    </span>
  );
});

function ColumnStepButton({
  disabled,
  onStep,
  step,
  targetLabel,
}: {
  disabled: boolean;
  onStep: (step: ColumnStep) => void;
  step: ColumnStep;
  targetLabel: string;
}) {
  const { Icon, label: labelForStep } = COLUMN_STEP_PRESENTATION[step];
  const label = labelForStep(targetLabel);
  return (
    <button
      type="button"
      className="ml-target-column-pager__step"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onStep(step);
      }}
      title={label}
    >
      <Icon size={12} strokeWidth={2} />
    </button>
  );
}

const ColumnChip = memo(function ColumnChip({ column }: { column: LensColumn }) {
  return (
    <span
      className="ml-target-column-pager__chip"
      title={column.dtype ? `${column.name} · ${column.dtype}` : column.name}
      translate="no"
    >
      {column.name}
    </span>
  );
});

function useColumnPagerLayout(columns: LensColumn[]): {
  layout: ColumnPagerLayout;
  measureRef: RefObject<HTMLSpanElement | null>;
  rootRef: RefObject<HTMLSpanElement | null>;
} {
  const rootRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<ColumnPagerLayout>({
    availableWidth: 0,
    chipWidths: [],
  });

  useLayoutEffect(() => {
    const measure = () => {
      const availableWidth = rootRef.current?.clientWidth ?? 0;
      const chipWidths = Array.from(measureRef.current?.children ?? [], (child) =>
        Math.ceil((child as HTMLElement).offsetWidth),
      );
      setLayout((current) => {
        if (
          current.availableWidth === availableWidth &&
          numberArraysEqual(current.chipWidths, chipWidths)
        ) {
          return current;
        }
        return { availableWidth, chipWidths };
      });
    };

    measure();

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (rootRef.current) observer?.observe(rootRef.current);
    if (measureRef.current) observer?.observe(measureRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [columns]);

  return { layout, measureRef, rootRef };
}

export function resolveColumnWindow({
  availableWidth,
  chipGap = CHIP_GAP_PX,
  chipWidths,
  navButtonWidth = NAV_BUTTON_WIDTH_PX,
  navGap = NAV_GAP_PX,
  requestedStartIndex,
}: ColumnWindowInput): ColumnWindow {
  const itemCount = chipWidths.length;
  if (itemCount === 0) {
    return {
      endIndex: 0,
      hasNext: false,
      hasPrevious: false,
      overflowing: false,
      startIndex: 0,
    };
  }

  const startIndex = clamp(requestedStartIndex, 0, itemCount - 1);
  const fullWidth =
    chipWidths.reduce((total, width) => total + width, 0) + chipGap * (itemCount - 1);
  const overflowing = availableWidth > 0 && fullWidth > availableWidth;
  if (!overflowing) {
    return {
      endIndex: itemCount,
      hasNext: false,
      hasPrevious: false,
      overflowing: false,
      startIndex: 0,
    };
  }

  const viewportWidth = Math.max(0, availableWidth - navButtonWidth * 2 - navGap * 2);
  let endIndex = startIndex;
  let usedWidth = 0;

  while (endIndex < itemCount) {
    const nextWidth = chipWidths[endIndex] ?? 0;
    const nextUsedWidth = endIndex === startIndex ? nextWidth : usedWidth + chipGap + nextWidth;
    if (endIndex > startIndex && nextUsedWidth > viewportWidth) break;
    usedWidth = nextUsedWidth;
    endIndex += 1;
  }

  if (endIndex === startIndex) {
    endIndex = Math.min(startIndex + 1, itemCount);
  }

  return {
    endIndex,
    hasNext: endIndex < itemCount,
    hasPrevious: startIndex > 0,
    overflowing: true,
    startIndex,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function numberArraysEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
