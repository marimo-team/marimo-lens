import { afterEach, describe, expect, test, vi } from "vitest";

import type { LensAnnotation, ResolvedHover } from "@/types";

import { createAnnotationAnchor, markerPosition } from "@/lib/annotation-anchors";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

describe("annotation anchors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  test("resolves markers from the live selected element after document reflow", () => {
    const root = document.createElement("section");
    root.id = "output-cell-a";
    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    wrapper.append(button);
    root.append(wrapper);
    document.body.append(root);

    setRect(root, 20, 100, 300, 220);
    setRect(wrapper, 30, 130, 260, 80);
    setRect(button, 40, 150, 120, 30);

    const anchor = createAnnotationAnchor(
      hoverFor(button, {
        displayCellId: "cell-a",
        rect: rect(40, 150, 120, 30),
      }),
    );

    setRect(root, 20, 420, 300, 220);
    setRect(wrapper, 30, 450, 260, 80);
    setRect(button, 40, 470, 120, 30);

    expect(markerPosition(annotationWith(anchor))).toEqual({
      left: 100,
      top: 485,
    });
  });

  test("falls back to the live cell offset when the exact element disappears", () => {
    const root = document.createElement("section");
    root.id = "output-cell-a";
    const button = document.createElement("button");
    root.append(button);
    document.body.append(root);

    setRect(root, 20, 100, 300, 220);
    setRect(button, 40, 150, 120, 30);

    const anchor = createAnnotationAnchor(
      hoverFor(button, {
        displayCellId: "cell-a",
        rect: rect(40, 150, 120, 30),
      }),
    );

    button.remove();
    setRect(root, 20, 420, 300, 220);

    expect(markerPosition(annotationWith(anchor))).toEqual({
      left: 100,
      top: 485,
    });
  });

  test("does not position annotations without structured anchors", () => {
    vi.spyOn(window, "scrollX", "get").mockReturnValue(12);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(30);

    expect(
      markerPosition({
        ...annotationWith(undefined),
        documentX: 112,
        documentY: 230,
      }),
    ).toBeNull();
  });
});

function annotationWith(anchor: LensAnnotation["anchor"]): LensAnnotation {
  return {
    id: "ml-1",
    targetId: "target-a",
    targetLabel: "Target A",
    comment: "Check this.",
    intent: "fix",
    severity: "important",
    element: "button",
    elementPath: "button",
    documentX: 0,
    documentY: 0,
    boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    createdAt: "2026-05-20T12:00:00Z",
    displayCellId: "cell-a",
    anchor,
  };
}

function hoverFor(
  element: Element,
  options: { displayCellId: string; rect: DOMRect },
): ResolvedHover {
  const target = {
    id: "target-a",
    label: "Target A",
    kind: "object" as const,
    cellId: "cell-def",
    displayCellIds: [options.displayCellId],
  };
  return {
    element,
    rect: options.rect,
    target,
    semanticSelection: surfaceSemanticSelection({
      target,
      element,
      kind: "target",
      granularity: "target",
    }),
    displayCellId: options.displayCellId,
    elementName: "button",
    elementPath: "section > button",
  };
}

function setRect(element: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(left, top, width, height));
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}
