import type { DomHint } from "@marimo-lens/protocol";

import { relativeOutputBounds } from "@marimo-lens/image-capture";
import { boundedUtf16 } from "@marimo-lens/protocol";

const MAX_TEXT_LENGTH = 240;
const MAX_LABEL_LENGTH = 160;
const MAX_PATH_LENGTH = 240;
const MAX_PATH_DEPTH = 6;
const NON_CONTENT_TEXT_ELEMENTS = new Set(["noscript", "script", "style", "template"]);

export function collectDomHint(element: Element, output: HTMLElement): DomHint {
  const role = boundedAttribute(element, "role");
  const ariaLabel = boundedAttribute(element, "aria-label");
  const title = boundedAttribute(element, "title");
  const text = boundedUtf16(normalizeText(contentText(element)), MAX_TEXT_LENGTH);
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

function contentText(element: Element): string {
  const ownerWindow = element.ownerDocument.defaultView;
  const renderedText =
    ownerWindow && element instanceof ownerWindow.HTMLElement ? element.innerText : null;
  if (renderedText !== null && renderedText !== undefined) return renderedText;
  if (NON_CONTENT_TEXT_ELEMENTS.has(element.localName)) return "";
  const text: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let parent = node.parentElement;
    while (parent && parent !== element) {
      if (NON_CONTENT_TEXT_ELEMENTS.has(parent.localName)) {
        parent = null;
        break;
      }
      parent = parent.parentElement;
    }
    if (parent === element) text.push(node.nodeValue ?? "");
  }
  return text.join(" ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compact(hint: DomHint): DomHint {
  const compacted: DomHint = { tag: hint.tag };
  if (hint.role) compacted.role = hint.role;
  if (hint.ariaLabel) compacted.ariaLabel = hint.ariaLabel;
  if (hint.title) compacted.title = hint.title;
  if (hint.text) compacted.text = hint.text;
  if (hint.path) compacted.path = hint.path;
  if (hint.bounds) compacted.bounds = hint.bounds;
  return compacted;
}
