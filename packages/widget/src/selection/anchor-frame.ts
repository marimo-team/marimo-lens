import type { AnchorFrame, SelectionAnchor } from "@marimo-lens/protocol";

import { relativeOutputBounds } from "@marimo-lens/image-capture";

import { composedParent, isShadowRoot } from "@/notebook/open-tree";

// Elements that keep their own size while the output around them reflows, so
// a mark placed on them stays on the same part when the output resizes.
const FRAME_TAGS = new Set(["canvas", "img", "video", "iframe"]);
const MAX_PATH_LENGTH = 240;
const MAX_PATH_DEPTH = 16;
// Rounding in layout can put a mark's edge a hair outside its frame.
const TOLERANCE = 0.002;
const SHADOW = "::shadow";

/**
 * Return the frame of a mark: the canvas, image, video, iframe, or outermost
 * SVG under it that contains the whole mark, or nothing when the mark sits on
 * content that reflows with the output.
 */
function anchorFrame(
  detail: Element,
  output: HTMLElement,
  anchor: SelectionAnchor,
): AnchorFrame | undefined {
  let frame: Element | null = null;
  for (let current: Element | null = detail; current && current !== output;) {
    if (current.localName === "svg") frame = current;
    else if (frame === null && FRAME_TAGS.has(current.localName)) {
      frame = current;
      break;
    }
    current = composedParent(current);
  }
  if (!frame) return undefined;
  const path = framePath(frame, output);
  if (!path) return undefined;
  const bounds = relativeOutputBounds(frame, output);
  return contains(bounds, anchor) ? { path, bounds } : undefined;
}

/** Return `anchor` on the frame of the element under it, or on the output alone. */
export function framedAnchor(
  anchor: SelectionAnchor,
  detail: Element,
  output: HTMLElement,
): SelectionAnchor {
  const bare: SelectionAnchor =
    anchor.kind === "point"
      ? { kind: "point", x: anchor.x, y: anchor.y }
      : { kind: "rect", x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
  const frame = anchorFrame(detail, output, bare);
  return frame ? { ...bare, frame } : bare;
}

/** Find the element a frame path names under `output`, if it still exists. */
export function resolveFrame(output: HTMLElement, path: string): Element | null {
  let node: Element | ShadowRoot = output;
  for (const part of path.split(" > ")) {
    if (part === SHADOW) {
      if (!("shadowRoot" in node) || !node.shadowRoot) return null;
      node = node.shadowRoot;
      continue;
    }
    const match = /^([a-z][\w-]*)(?::nth-of-type\((\d+)\))?$/.exec(part);
    if (!match) return null;
    const [, tag, nth] = match;
    const element: Element | undefined = Array.from(node.children).filter(
      (child) => child.localName === tag,
    )[Number(nth ?? 1) - 1];
    if (!element) return null;
    node = element;
  }
  return node === output || isShadowRoot(node) ? null : node;
}

function framePath(frame: Element, output: HTMLElement): string | null {
  const parts: string[] = [];
  let current: Element = frame;
  while (current !== output) {
    if (parts.length >= MAX_PATH_DEPTH) return null;
    const root = current.getRootNode();
    const parent = current.parentElement ?? (isShadowRoot(root) ? root : null);
    if (!parent) return null;
    parts.unshift(pathPart(current, parent));
    if (isShadowRoot(parent)) {
      parts.unshift(SHADOW);
      current = parent.host;
    } else {
      current = parent;
    }
  }
  const path = parts.join(" > ");
  return path && path.length <= MAX_PATH_LENGTH ? path : null;
}

function pathPart(element: Element, parent: Element | ShadowRoot): string {
  const tag = element.localName;
  const siblings = Array.from(parent.children).filter((child) => child.localName === tag);
  return siblings.length <= 1 ? tag : `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
}

function contains(bounds: AnchorFrame["bounds"], anchor: SelectionAnchor): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const right = anchor.x + (anchor.kind === "rect" ? anchor.width : 0);
  const bottom = anchor.y + (anchor.kind === "rect" ? anchor.height : 0);
  return (
    anchor.x >= bounds.x - TOLERANCE &&
    anchor.y >= bounds.y - TOLERANCE &&
    right <= bounds.x + bounds.width + TOLERANCE &&
    bottom <= bounds.y + bounds.height + TOLERANCE
  );
}
