import type { DomHint } from "@marimo-lens/protocol";

import { relativeOutputBounds } from "@marimo-lens/image-capture";
import { boundedUtf16 } from "@marimo-lens/protocol";

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
    bounds: relativeOutputBounds(element, output),
  });
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
    } else if (isShadowRoot(root)) {
      parts.unshift("::shadow");
      current = root.host;
    } else {
      current = null;
    }
  }
  return parts.join(" > ");
}

function isShadowRoot(root: Node): root is ShadowRoot {
  return root.nodeType === 11 && "host" in root;
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
