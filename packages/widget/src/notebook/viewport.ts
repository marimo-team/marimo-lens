import type { TargetSelector } from "@marimo-lens/protocol";

import { useEffect, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

export function observeVisibleViewport(
  surface: Element,
  onChange: (bounds: DOMRectReadOnly) => void,
): () => void {
  const ownerWindow = surface.ownerDocument.defaultView;
  if (!ownerWindow?.IntersectionObserver) return () => {};

  const observer = new ownerWindow.IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry?.isIntersecting) onChange(entry.intersectionRect);
  });
  observer.observe(surface);

  let frame = 0;
  const refresh = () => {
    if (frame) return;
    frame = ownerWindow.requestAnimationFrame(() => {
      frame = 0;
      observer.unobserve(surface);
      observer.observe(surface);
    });
  };
  // VS Code translates its oversized webview without scrolling this document.
  // Re-observe because translation can preserve the intersection ratio.
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate the host message at the browser I/O boundary.
    if (data && typeof data === "object" && "type" in data && data.type === "view-scroll") {
      refresh();
    }
  };
  ownerWindow.addEventListener("message", onMessage);
  ownerWindow.addEventListener("resize", refresh);
  return () => {
    ownerWindow.cancelAnimationFrame(frame);
    observer.disconnect();
    ownerWindow.removeEventListener("message", onMessage);
    ownerWindow.removeEventListener("resize", refresh);
  };
}

export function useViewportRevision(active = true, selector?: TargetSelector): number {
  const dom = useNotebookDom();
  const [revision, setRevision] = useState(0);

  useEffect(
    () =>
      active
        ? dom.subscribeLayout(() => setRevision((current) => current + 1), selector)
        : undefined,
    [active, dom, selector],
  );

  return revision;
}
