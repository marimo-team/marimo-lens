import type { DomHint, DomHintBounds } from "@/contracts";

import { boundedUtf16 } from "@/bounded-text";

const MAX_TEXT_LENGTH = 240;
const MAX_LABEL_LENGTH = 160;
const MAX_PATH_LENGTH = 240;
const MAX_PATH_DEPTH = 6;

export function collectDomHint(element: Element, output: HTMLElement): DomHint {
  const role = boundedAttribute(element, "role");
  const ariaLabel = boundedAttribute(element, "aria-label");
  const title = boundedAttribute(element, "title");
  const text = boundedUtf16(normalizeText(element.textContent ?? ""), MAX_TEXT_LENGTH);
  const path = boundedUtf16(elementPath(element, output), MAX_PATH_LENGTH);
  return compact({
    tag: element.tagName.toLowerCase(),
    role,
    ariaLabel,
    title,
    text,
    path,
    bounds: relativeBounds(element, output),
  });
}

function relativeBounds(element: Element, output: HTMLElement): DomHintBounds {
  const elementRect = element.getBoundingClientRect();
  const outputRect = output.getBoundingClientRect();
  const width = Math.max(output.scrollWidth, outputRect.width, 1);
  const height = Math.max(output.scrollHeight, outputRect.height, 1);
  const x = clamp((elementRect.left - outputRect.left + output.scrollLeft) / width, 0, 1);
  const y = clamp((elementRect.top - outputRect.top + output.scrollTop) / height, 0, 1);
  return {
    x,
    y,
    width: clamp(elementRect.width / width, 0, 1 - x),
    height: clamp(elementRect.height / height, 0, 1 - y),
  };
}

function elementPath(element: Element, output: HTMLElement): string {
  if (element === output) return output.tagName.toLowerCase();
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== output && parts.length < MAX_PATH_DEPTH) {
    parts.unshift(pathPart(current));
    const root = current.getRootNode();
    if (current.parentElement) {
      current = current.parentElement;
    } else if (root instanceof ShadowRoot) {
      parts.unshift("::shadow");
      current = root.host;
    } else {
      current = null;
    }
  }
  return parts.join(" > ");
}

function pathPart(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (siblings.length <= 1) return tag;
  return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
}

function boundedAttribute(element: Element, name: string): string | undefined {
  const value = boundedUtf16(normalizeText(element.getAttribute(name) ?? ""), MAX_LABEL_LENGTH);
  return value || undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compact(hint: DomHint): DomHint {
  return Object.fromEntries(
    Object.entries(hint).filter(([, value]) => value !== undefined && value !== ""),
  ) as DomHint;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
