import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { ViewportBounds } from "@/notebook/viewport";
import type { TargetAttentionPresentation } from "@/transient/target-attention";

import {
  TargetAttentionAnnouncement,
  TargetAttentionFallback,
  TargetAttentionIndicator,
  projectTargetAttentionSurface,
} from "@/transient/target-attention-indicator";

import { render } from "../support/render";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("target attention presentation", () => {
  test.each([
    {
      layout: "a wide pane",
      width: 1_280,
      pane: WIDE_PANE,
      bounds: new DOMRect(980, 80, 200, 160),
    },
    {
      layout: "a narrow pane",
      width: 480,
      pane: NARROW_PANE,
      bounds: new DOMRect(190, 80, 80, 160),
    },
    {
      layout: "a pane that cuts off the target's left side",
      width: 1_280,
      pane: new DOMRect(500, 0, 700, 680),
      bounds: new DOMRect(450, 100, 200, 160),
    },
    {
      layout: "a pane that cuts off the target's right side",
      width: 1_280,
      pane: new DOMRect(300, 0, 600, 680),
      bounds: new DOMRect(800, 100, 200, 160),
    },
  ])("places the label above the target inside $layout", ({ width, pane, bounds }) => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => bounds;
    document.body.appendChild(target);
    const ownerWindow = viewport(width, 720);

    const view = projectTargetAttentionSurface(
      activityPresentation(target, undefined, pane),
      ownerWindow,
    ).view;
    if (!view) throw new Error("Expected a visible label");

    // The label is right-anchored and grows leftward up to its max width.
    const labelRight = ownerWindow.innerWidth - Number(view.label.right);
    const labelLeft = labelRight - Number(view.label.maxWidth);
    const labelBottom = ownerWindow.innerHeight - Number(view.label.bottom);
    expect(view.ring).toEqual({
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
      height: bounds.height,
    });
    expect(labelLeft).toBeGreaterThanOrEqual(pane.left);
    expect(labelRight).toBeLessThanOrEqual(pane.right);
    expect(labelRight).toBeGreaterThan(Math.max(bounds.left, pane.left));
    expect(labelRight).toBeLessThanOrEqual(bounds.right);
    expect(labelBottom).toBeLessThan(bounds.top);
  });

  test("uses fallback for a visible target whose measured label does not fit", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target, undefined, NARROW_PANE);
    const ownerWindow = viewport(480, 720);

    const surface = projectTargetAttentionSurface(presentation, ownerWindow, {
      height: 226,
      maxWidth: 400,
    });

    expect(surface.view).toBeNull();
    expect(surface.fallback).toEqual({ presentation, reason: "label-space" });
  });

  test("uses fallback when the target is hidden behind application chrome", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(100, 100, 200, 160);
    document.body.appendChild(target);
    const presentation = activityPresentation(target, undefined, new DOMRect(500, 0, 700, 680));

    expect(projectTargetAttentionSurface(presentation, viewport(1_280, 720))).toEqual({
      view: null,
      fallback: { presentation, reason: "offscreen" },
    });
  });

  test("waits for the controller to create room above the target", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(target);
    const ownerWindow = viewport(1280, 720);

    expect(
      projectTargetAttentionSurface(activityPresentation(target), ownerWindow).view,
    ).toBeNull();
  });

  test("remeasures a suppressed label when its projected width changes", () => {
    let targetWidth = 400;
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, targetWidth, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target, undefined, NARROW_PANE);
    const measurement = { height: 226, maxWidth: 400 };

    expect(
      projectTargetAttentionSurface(presentation, viewport(480, 720), measurement).view,
    ).toBeNull();

    targetWidth = 900;
    expect(
      projectTargetAttentionSurface(
        { ...presentation, bounds: target.getBoundingClientRect(), viewport: WIDE_PANE },
        viewport(1_280, 720),
        measurement,
      ).view,
    ).not.toBeNull();
  });

  test("reports the rendered label height", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const view = projectTargetAttentionSurface(presentation, window).view;
    const onLabelMeasure = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-marimo-lens-target-attention-label")
        ? new DOMRect(0, 0, 320, 226)
        : new DOMRect();
    });

    render(<TargetAttentionIndicator view={view} onLabelMeasure={onLabelMeasure} />);

    expect(onLabelMeasure).toHaveBeenCalledWith(presentation.sequence, {
      height: 226,
      maxWidth: view?.labelMaxWidth,
    });
  });

  test("renders one capture-safe indicator and one stable live announcement", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const view = projectTargetAttentionSurface(presentation, window).view;

    render(
      <>
        <TargetAttentionIndicator view={view} />
        <TargetAttentionAnnouncement presentation={presentation} />
      </>,
    );

    const indicator = document.querySelector<HTMLElement>("[data-marimo-lens-target-attention]");
    expect(indicator?.dataset.marimoLensUi).toBe("true");
    expect(indicator?.querySelector("[data-marimo-lens-attention-status]")?.textContent).toBe(
      "Working",
    );
    expect(indicator?.querySelector("[data-marimo-lens-attention-message]")?.textContent).toBe(
      "Updating the aggregation.",
    );
    expect(indicator?.dataset.targetLabel).toBe("BYtC");
    expect(indicator?.querySelector("[data-marimo-lens-working-indicator]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-target-attention-status]")?.textContent).toBe(
      "Working in cell BYtC. Updating the aggregation.",
    );
    expect(target.attributes).toHaveLength(0);
  });

  test.each([
    {
      name: "an activity label",
      kind: "activity",
      label: "On it",
      message: "Updating the aggregation.",
      reason: "target-unavailable",
      status: "On it",
      announcement: "On it in cell BYtC. Updating the aggregation.",
    },
    {
      name: "a reveal label",
      kind: "reveal",
      label: "Updated chart",
      message: REVEAL_MESSAGE,
      reason: "target-unavailable",
      status: "Updated chart",
      announcement: `Updated chart in cell BYtC. ${REVEAL_MESSAGE}`,
    },
    {
      name: "no reveal label",
      kind: "reveal",
      label: null,
      message: null,
      reason: "label-space",
      status: "Ready",
      announcement: "Revealed cell BYtC.",
    },
  ] as const)(
    "shows $name the same way in the indicator, notice, and announcement",
    ({ kind, label, message, reason, status, announcement }) => {
      const target = document.createElement("section");
      target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
      document.body.appendChild(target);
      const presentation: TargetAttentionPresentation = {
        ...activityPresentation(target),
        kind,
        label,
        message,
      };

      render(
        <>
          <TargetAttentionIndicator
            view={projectTargetAttentionSurface(presentation, window).view}
          />
          <TargetAttentionFallback presentation={presentation} reason={reason} />
          <TargetAttentionAnnouncement presentation={presentation} />
        </>,
      );

      const indicator = document.querySelector("[data-marimo-lens-target-attention]");
      const notice = document.querySelector("[data-marimo-lens-target-attention-notice]");
      expect(indicator?.querySelector("[data-marimo-lens-attention-status]")?.textContent).toBe(
        status,
      );
      expect(notice?.querySelector("[data-marimo-lens-attention-status]")?.textContent).toBe(
        status,
      );
      expect(
        indicator?.querySelector("[data-marimo-lens-attention-message]")?.textContent ?? null,
      ).toBe(message);
      expect(
        document.querySelector("[data-marimo-lens-target-attention-status]")?.textContent,
      ).toBe(announcement);
      expect(!!document.querySelector("[data-marimo-lens-working-indicator]")).toBe(
        kind === "activity",
      );
    },
  );
});

const REVEAL_MESSAGE =
  "Updated the aggregation and verified the chart.\nThe regional totals now match the source table.";

const WIDE_PANE = new DOMRect(0, 0, 1_280, 720);
const NARROW_PANE = new DOMRect(0, 0, 480, 720);

function activityPresentation(
  target: HTMLElement,
  label?: string,
  pane: ViewportBounds = WIDE_PANE,
): TargetAttentionPresentation {
  return {
    kind: "activity",
    sequence: 1,
    locator: { kind: "cell", label: "BYtC", resolve: () => target },
    target,
    bounds: target.getBoundingClientRect(),
    viewport: pane,
    expiresAt: null,
    framing: "settled",
    phase: "active",
    label: label ?? null,
    message: "Updating the aggregation.",
  };
}

function viewport(width: number, height: number) {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const ownerWindow = frame.contentWindow;
  if (!ownerWindow) throw new Error("Viewport frame did not create a window");
  Object.defineProperties(ownerWindow, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
  });
  return ownerWindow;
}
