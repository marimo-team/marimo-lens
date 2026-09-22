export type ViewportBounds = Pick<
  DOMRectReadOnly,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;

export function windowViewportBounds(ownerWindow: Window): ViewportBounds {
  const viewport = ownerWindow.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? ownerWindow.innerWidth;
  const height = viewport?.height ?? ownerWindow.innerHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function intersectBounds(
  first: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
  second: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
): ViewportBounds | null {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  return right > left && bottom > top
    ? { left, top, right, bottom, width: right - left, height: bottom - top }
    : null;
}

export function sameBounds(first: ViewportBounds | null, second: ViewportBounds | null): boolean {
  return (
    first === second ||
    (first !== null &&
      second !== null &&
      first.left === second.left &&
      first.top === second.top &&
      first.right === second.right &&
      first.bottom === second.bottom)
  );
}

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
