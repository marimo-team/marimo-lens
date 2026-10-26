import type { SelectionAnchor } from "@marimo-lens/protocol";

import { useLayoutEffect, useState } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { anchorCenter, attachToNestedScroll, type ScrollAttachment } from "./anchor";

type ScrollAttachmentState = {
  output: HTMLElement;
  anchor: string;
  contentRevision: number;
  target: Element | null;
  attachment: ScrollAttachment;
};

export function useScrollAttachment(
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
  viewportRevision: number,
): ScrollAttachment {
  const anchorKey = JSON.stringify(anchor);
  const [state, setState] = useState(() =>
    createScrollAttachmentState(dom, output, anchor, anchorKey),
  );
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The attachment reads scroll containers from the committed DOM.
    setState((current) => refreshScrollAttachmentState(current, dom, output, anchor, anchorKey));
  }, [anchorKey, dom, output, anchor, viewportRevision]);
  return state.attachment;
}

function createScrollAttachmentState(
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
  anchorKey: string,
): ScrollAttachmentState {
  const target = attachmentTarget(dom, output, anchor);
  return {
    output,
    anchor: anchorKey,
    contentRevision: dom.contentRevision(output),
    target,
    attachment: target
      ? attachToNestedScroll(output, target)
      : { frames: [], ancestorBaselines: [] },
  };
}

function refreshScrollAttachmentState(
  current: ScrollAttachmentState,
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
  anchorKey: string,
): ScrollAttachmentState {
  const reset = current.output !== output || current.anchor !== anchorKey;
  const contentRevision = dom.contentRevision(output);
  const target =
    reset ||
    current.target === null ||
    !current.target.isConnected ||
    (current.attachment.frames.length === 0 && current.contentRevision !== contentRevision)
      ? attachmentTarget(dom, output, anchor)
      : current.target;
  const attachment = target
    ? attachToNestedScroll(output, target, reset ? undefined : current.attachment)
    : { frames: [], ancestorBaselines: [] };
  if (
    !reset &&
    current.contentRevision === contentRevision &&
    current.target === target &&
    hasSameScrollAttachment(current.attachment, attachment)
  ) {
    return current;
  }
  return {
    output,
    anchor: anchorKey,
    contentRevision,
    target,
    attachment,
  };
}

function attachmentTarget(
  dom: NotebookDomAdapter,
  output: HTMLElement,
  anchor: SelectionAnchor,
): Element | null {
  const point = anchorCenter(output, anchor);
  return "elementsFromPoint" in dom.document ? dom.deepestElementAtPoint(point.x, point.y) : null;
}

function hasSameScrollAttachment(first: ScrollAttachment, second: ScrollAttachment): boolean {
  return (
    hasSameElements(first.frames, second.frames) &&
    hasSameElements(first.ancestorBaselines, second.ancestorBaselines)
  );
}

function hasSameElements(
  first: ReadonlyArray<{ element: Element }>,
  second: ReadonlyArray<{ element: Element }>,
): boolean {
  return (
    first.length === second.length &&
    first.every((item, index) => item.element === second[index]?.element)
  );
}
