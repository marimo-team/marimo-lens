import type { LensTarget, ViewportPoint } from "@/types";

import { isInteractiveTarget } from "@/lib/column-targeting";
import { queryFirstCrossingShadow } from "@/lib/shadow-dom";
import { normalizeText } from "@/lib/text-format";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";
import { surfaceAtElementOrPoint } from "@/selection/surface-targeting";

const INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='radio']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "marimo-button",
  "marimo-checkbox",
  "marimo-code-editor",
  "marimo-date",
  "marimo-datetime",
  "marimo-dropdown",
  "marimo-file",
  "marimo-multiselect",
  "marimo-number",
  "marimo-radio",
  "marimo-slider",
  "marimo-switch",
  "marimo-text",
  "marimo-text-area",
  "marimo-anywidget",
  "marimo-ui-element",
  "[data-marimo-ui-element]",
].join(",");

export const interactiveSelectionPlugin = defineSelectionPlugin({
  id: "interactive",
  surface: "interactive",
  priority: 830,
  select: ({ displayCellId, displayTargets, element, point, targets }) => {
    const surface = interactiveSurface(element, point);
    const interactiveTargets = targets.filter(isInteractiveTarget);
    const target = surface
      ? bestInteractiveTarget(surface, interactiveTargets)
      : fallbackDisplayInteractiveTarget(displayTargets);
    if (!target) return null;
    const selectionElement = surface ?? element;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        surface: "interactive",
        element: selectionElement,
        sourceElement: element,
        kind: "interactive-control",
        granularity: "item",
        hitKind: "interactive-control",
        selector: describeSurface(selectionElement),
        data: {
          component: componentName(selectionElement) ?? target.component,
          displayCellId,
          interactiveRole:
            selectionElement.getAttribute("role") || selectionElement.tagName.toLowerCase(),
          surface: "interactive",
          surfaceSelector: describeSurface(selectionElement),
        },
      }),
      displayCellId,
      score: surface && target.component && componentName(surface) === target.component ? 82 : 72,
    };
  },
  previewElement: ({ target }) => {
    if (!isInteractiveTarget(target)) return null;
    if (target.component) {
      const element = queryFirstCrossingShadow(document, target.component);
      if (element) return element;
    }
    return null;
  },
});

function interactiveSurface(element: Element, point?: ViewportPoint): Element | null {
  return surfaceAtElementOrPoint(element, INTERACTIVE_SELECTOR, point);
}

function fallbackDisplayInteractiveTarget(targets: LensTarget[]): LensTarget | null {
  const candidates = targets.filter(
    (target) => isInteractiveTarget(target) && target.kind !== "output",
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function bestInteractiveTarget(surface: Element, targets: LensTarget[]): LensTarget | null {
  if (targets.length === 0) return null;
  const component = componentName(surface);
  const scored = targets
    .map((target) => ({ target, score: scoreInteractiveTarget(surface, target, component) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return targets.length === 1 ? targets[0] : null;
  if (scored[1]?.score === scored[0].score) return null;
  return scored[0].target;
}

function scoreInteractiveTarget(
  surface: Element,
  target: LensTarget,
  component: string | null,
): number {
  let score = 0;
  if (component && target.component === component) score += 40;
  const text = interactiveText(surface);
  const label = normalizeText(target.label);
  const variable = normalizeText(target.variable);
  if (label && text.includes(label)) score += 16;
  if (variable && text.includes(variable)) score += 12;
  if (target.kind === "output") score -= 4;
  return score;
}

function componentName(element: Element): string | null {
  let current: Element | null = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag.startsWith("marimo-") && tag !== "marimo-ui-element") return tag;
    const parent: Element | null = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }
    const root = current.getRootNode?.();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function interactiveText(element: Element): string {
  return normalizeText(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.textContent,
    ].join(" "),
  );
}

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  const role = element.getAttribute("role");
  if (role) return `[role="${role}"]`;
  return element.tagName.toLowerCase();
}
