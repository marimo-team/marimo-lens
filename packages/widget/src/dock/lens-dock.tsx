import * as stylex from "@stylexjs/stylex";
import { ChevronDown, GripVertical, List, MousePointer2 } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { useLens, type LensState } from "@/context/lens-context";
import { historyShows } from "@/context/record-index";
import { ui } from "@/styles/primitives";
import { ResolutionReceipt } from "@/transient/resolution-receipt";
import { LensLogo } from "@/ui/components/lens-logo";

import { dockStyles } from "./lens-dock.styles";
import { openRequestCount, RequestSheet } from "./request-sheet";
import { useDockMotion } from "./use-dock-motion";
import { useDockPosition } from "./use-dock-position";
import {
  LENS_SELECTION_SHORTCUT,
  LENS_SELECTION_SHORTCUT_LABEL,
  useSelectionShortcut,
} from "./use-selection-shortcut";
import { useSheetFocus } from "./use-sheet-focus";

const dockVariables: CSSProperties & Record<`--${string}`, string> = {
  "--ml-safe-area-bottom": "env(safe-area-inset-bottom, 0px)",
};

const SELECT = "[data-ml-select]";
const LIST = "[data-ml-list]";
const TAB = "[data-ml-dock-tab]";

/**
 * The document's Lens dock. `notice` takes the panel above the dock from the
 * resolution receipt, as cell attention that cannot show beside its cell does.
 */
export function LensDock({ notice }: { notice?: ReactNode }) {
  const { state, actions } = useLens();
  const dockRef = useRef<HTMLElement>(null);
  useDockPosition(dockRef);
  useDockMotion(dockRef);
  const [expanded, setExpanded] = useState(true);
  const focus = useDockFocus(dockRef);
  const { armed, interactionLocked, sheet } = state;
  const enterSelectionMode = () => {
    setExpanded(true);
    if (!armed && !interactionLocked) actions.toggleArmed();
    focus(SELECT);
  };
  const sheetOpen = expanded && sheet.open;
  useSheetFocus(dockRef, sheetOpen, sheet.tab, sheet.focusedHistoryKey);
  useSelectionShortcut(interactionLocked, enterSelectionMode);
  const hasNotice = notice != null || state.receipt !== null;
  const panelNotice = notice ?? (
    <ResolutionReceipt
      onReveal={() => setExpanded(true)}
      onRefocus={() => focus(expanded ? SELECT : TAB)}
    />
  );

  return (
    <aside
      ref={dockRef}
      {...stylex.props(dockStyles.dock)}
      style={dockVariables}
      data-expanded={expanded ? "true" : "false"}
      data-marimo-lens-dock
      data-marimo-lens-ui
      aria-label="marimo-lens"
    >
      <span id="ml-dock-move-help" hidden>
        Drag or use arrow keys to move. Shift moves faster. Home resets position.
      </span>
      {sheetOpen || hasNotice ? (
        <div
          {...stylex.props(dockStyles.panel)}
          data-marimo-lens-dock-panel
          data-content={sheetOpen ? "requests" : "notice"}
        >
          {sheetOpen ? (
            <RequestSheet
              notice={hasNotice ? panelNotice : null}
              onClose={() => {
                actions.toggleSheet();
                focus(LIST);
              }}
            />
          ) : (
            panelNotice
          )}
        </div>
      ) : null}
      {expanded ? (
        <DockBar
          onCollapse={() => {
            if (sheet.open) actions.toggleSheet();
            if (armed) actions.toggleArmed();
            setExpanded(false);
            focus(TAB);
          }}
        />
      ) : (
        <DockTab
          onExpand={() => {
            setExpanded(true);
            focus(SELECT);
          }}
        />
      )}
    </aside>
  );
}

/**
 * Focus a dock control by selector. A control that the same state change
 * mounts, such as the collapsed tab, takes focus once that change commits.
 */
function useDockFocus(dockRef: RefObject<HTMLElement | null>) {
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    const selector = pending.current;
    if (selector === null) return;
    pending.current = null;
    dockRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  return (selector: string) => {
    const control = dockRef.current?.querySelector<HTMLElement>(selector);
    if (control) control.focus();
    else pending.current = selector;
  };
}

/**
 * Describe the requests for an accessible name, such as "2 open, 3 in history",
 * or return null when the Lens has no requests to show.
 */
function requestsLabel(state: LensState): string | null {
  const open = openRequestCount(state);
  if (open === 0 && !historyShows(state.history)) return null;
  const history = state.history ? `, ${state.history.entries.length} in history` : "";
  return `${open} open${history}`;
}

/** The expanded dock: move, select, open the requests sheet, and collapse. */
function DockBar({ onCollapse }: { onCollapse: () => void }) {
  const { state, actions } = useLens();
  const { armed } = state;
  const label = requestsLabel(state);
  return (
    <div
      {...stylex.props(dockStyles.surface, dockStyles.bar)}
      data-marimo-lens-dockbar
      data-marimo-lens-dock-surface
      data-armed={armed ? "true" : "false"}
    >
      <button
        {...stylex.props(ui.interactive, dockStyles.action, dockStyles.dragHandle, dockStyles.grip)}
        type="button"
        data-ml-dock-drag
        aria-label="Move Lens"
        aria-describedby="ml-dock-move-help"
        title="Move Lens · Arrow keys to move · Home to reset"
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <button
        {...stylex.props(
          ui.interactive,
          dockStyles.action,
          dockStyles.select,
          armed && dockStyles.selectArmed,
        )}
        type="button"
        aria-pressed={armed}
        aria-keyshortcuts={
          armed
            ? `${LENS_SELECTION_SHORTCUT} ArrowUp ArrowDown Enter Escape`
            : LENS_SELECTION_SHORTCUT
        }
        data-ml-select
        disabled={state.interactionLocked}
        onClick={actions.toggleArmed}
        aria-label={armed ? "Cancel selection mode" : "Select a target"}
        title={
          armed
            ? "Selection mode active (Escape to exit)"
            : `Select a target (${LENS_SELECTION_SHORTCUT_LABEL})`
        }
      >
        <MousePointer2
          {...stylex.props(armed && dockStyles.selectIconArmed)}
          size={15}
          aria-hidden="true"
        />
        <span>{armed ? "Click or drag" : "Select"}</span>
        {armed ? <kbd {...stylex.props(dockStyles.shortcut)}>ESC</kbd> : null}
      </button>
      {label === null ? null : (
        <>
          <span {...stylex.props(dockStyles.separator)} aria-hidden="true" />
          <button
            {...stylex.props(ui.interactive, dockStyles.action, dockStyles.requests)}
            type="button"
            data-ml-list
            disabled={state.interactionLocked || armed}
            onClick={actions.toggleSheet}
            aria-expanded={state.sheet.open}
            aria-controls="marimo-lens-requests"
            aria-label={`Requests, ${label}`}
            title="Requests"
          >
            <List size={15} aria-hidden="true" />
            <span {...stylex.props(dockStyles.count)}>{openRequestCount(state)}</span>
          </button>
        </>
      )}
      <span {...stylex.props(dockStyles.separator)} aria-hidden="true" />
      <button
        {...stylex.props(ui.interactive, dockStyles.action, dockStyles.icon)}
        type="button"
        data-ml-dock-toggle
        onClick={onCollapse}
        aria-label="Collapse Lens"
        title="Collapse Lens"
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The collapsed dock: a draggable tab that opens Lens again. */
function DockTab({ onExpand }: { onExpand: () => void }) {
  const { state } = useLens();
  const label = requestsLabel(state);
  const open = openRequestCount(state);
  return (
    <button
      {...stylex.props(
        ui.interactive,
        dockStyles.surface,
        dockStyles.action,
        dockStyles.dragHandle,
        dockStyles.tab,
      )}
      type="button"
      data-marimo-lens-dock-surface
      data-ml-dock-tab
      data-ml-dock-toggle
      data-ml-dock-drag
      aria-describedby="ml-dock-move-help"
      onClick={onExpand}
      aria-label={label === null ? "Expand Lens" : `Expand Lens, ${label}`}
      title="Expand Lens · Drag to move"
    >
      <span
        {...stylex.props(dockStyles.collapsedGrip)}
        data-marimo-lens-collapsed-grip
        aria-hidden="true"
      >
        <GripVertical size={14} />
      </span>
      <LensLogo />
      {open > 0 ? (
        <span {...stylex.props(dockStyles.badge)} aria-hidden="true">
          {open}
        </span>
      ) : null}
    </button>
  );
}
