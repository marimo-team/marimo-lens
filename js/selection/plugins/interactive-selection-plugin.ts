import { isInteractiveTarget } from "@/lib/column-targeting";
import { closestCrossingShadow, queryFirstCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";
import type { LensTarget } from "@/types";

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
  "marimo-anywidget",
  "marimo-ui-element",
  "[data-marimo-ui-element]",
].join(",");

export const interactiveSelectionPlugin = defineSelectionPlugin({
  id: "interactive",
  surface: "interactive",
  priority: 830,
  select: ({ element, targets }) => {
    const surface = closestCrossingShadow(element, INTERACTIVE_SELECTOR);
    if (!surface) return null;
    const target = bestInteractiveTarget(surface, targets.filter(isInteractiveTarget));
    if (!target) return null;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        element: surface,
        sourceElement: element,
        kind: "interactive-control",
        granularity: "item",
        hitKind: "interactive-control",
        selector: describeSurface(surface),
        data: {
          component: componentName(surface),
          interactiveRole: surface.getAttribute("role") || surface.tagName.toLowerCase(),
          surface: "interactive",
          surfaceSelector: describeSurface(surface),
        },
      }),
      score: target.component && componentName(surface) === target.component ? 82 : 72,
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
  const label = normalize(target.label);
  const variable = normalize(target.variable);
  if (label && text.includes(label)) score += 16;
  if (variable && text.includes(variable)) score += 12;
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
  return normalize(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.textContent,
    ].join(" "),
  );
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  const role = element.getAttribute("role");
  if (role) return `[role="${role}"]`;
  return element.tagName.toLowerCase();
}
