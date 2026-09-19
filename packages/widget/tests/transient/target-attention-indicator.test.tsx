import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { TargetAttentionPresentation } from "@/transient/target-attention";

import {
  TargetAttentionAnnouncement,
  TargetAttentionFallback,
  TargetAttentionIndicator,
  projectTargetAttention,
  projectTargetAttentionSurface,
} from "@/transient/target-attention-indicator";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("target attention presentation", () => {
  test("anchors a visible label above the target at its top-right edge", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(980, 80, 200, 160);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const ownerWindow = viewport(1280, 720);

    const view = projectTargetAttention(presentation, ownerWindow);

    expect(view?.ring).toMatchObject({ top: 80, left: 980, width: 200, height: 160 });
    expect(view?.label.right).toBe(108);
    expect(view?.label.maxWidth).toBe(480);
    expect(view?.label.bottom).toBe(648);
    expect(view?.label.top).toBeUndefined();
  });

  test("uses fallback for a visible target whose measured label does not fit", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const ownerWindow = viewport(480, 720);

    const surface = projectTargetAttentionSurface(presentation, ownerWindow, {
      height: 226,
      maxWidth: 400,
    });

    expect(surface.view).toBeNull();
    expect(surface.fallback).toEqual({ presentation, reason: "label-space" });
  });

  test("waits for an offscreen target to finish scrolling before using fallback", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 740, 400, 240);
    document.body.appendChild(target);
    const presentation = { ...activityPresentation(target), framing: "pending" as const };
    const ownerWindow = viewport(480, 720);

    expect(projectTargetAttentionSurface(presentation, ownerWindow)).toEqual({
      view: null,
      fallback: null,
    });
  });

  test("uses fallback after offscreen framing settles", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 740, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const ownerWindow = viewport(480, 720);

    expect(projectTargetAttentionSurface(presentation, ownerWindow)).toEqual({
      view: null,
      fallback: { presentation, reason: "offscreen" },
    });
  });

  test("anchors an above-target label by its bottom edge", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const ownerWindow = viewport(1280, 720);

    const view = projectTargetAttention(activityPresentation(target), ownerWindow);

    expect(view?.label.bottom).toBe(428);
    expect(view?.label.top).toBeUndefined();
  });

  test("keeps a long reveal message above its target", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const presentation: TargetAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      label: "Updated chart",
      message: "A".repeat(300),
    };
    const ownerWindow = viewport(1280, 720);

    const view = projectTargetAttention(presentation, ownerWindow, {
      height: 226,
      maxWidth: 400,
    });

    expect(view?.label.bottom).toBe(428);
    expect(view?.label.top).toBeUndefined();
  });

  test("shrinks a right-anchored label to the remaining narrow viewport", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(190, 80, 80, 160);
    document.body.appendChild(target);
    const narrowWindow = viewport(480, 720);

    const view = projectTargetAttention(activityPresentation(target), narrowWindow);

    expect(view?.label.right).toBe(218);
    expect(view?.label.left).toBeUndefined();
    expect(view?.label.maxWidth).toBe(250);
  });

  test("waits for the controller to create room above the target", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
    document.body.appendChild(target);
    const ownerWindow = viewport(1280, 720);

    expect(projectTargetAttention(activityPresentation(target), ownerWindow)).toBeNull();
  });

  test("suppresses a rendered label that cannot fit above the target", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, 400, 240);
    document.body.appendChild(target);
    const ownerWindow = viewport(480, 720);

    expect(
      projectTargetAttention(activityPresentation(target), ownerWindow, {
        height: 226,
        maxWidth: 400,
      }),
    ).toBeNull();
  });

  test("remeasures a suppressed label when its projected width changes", () => {
    let targetWidth = 400;
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, targetWidth, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const measurement = { height: 226, maxWidth: 400 };

    expect(projectTargetAttention(presentation, viewport(480, 720), measurement)).toBeNull();

    targetWidth = 900;
    expect(
      projectTargetAttention(
        { ...presentation, bounds: target.getBoundingClientRect() },
        viewport(1_280, 720),
        measurement,
      )?.labelMaxWidth,
    ).toBe(480);
  });

  test("reports the rendered label height", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const view = projectTargetAttention(presentation, window);
    const onLabelMeasure = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-marimo-lens-target-attention-label")
          ? new DOMRect(0, 0, 320, 226)
          : new DOMRect();
      },
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(<TargetAttentionIndicator view={view} onLabelMeasure={onLabelMeasure} />),
    );

    expect(onLabelMeasure).toHaveBeenCalledWith(presentation.sequence, {
      height: 226,
      maxWidth: 400,
    });
  });

  test("renders one capture-safe indicator and one stable live announcement", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const view = projectTargetAttention(presentation, window);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <>
          <TargetAttentionIndicator view={view} />
          <TargetAttentionAnnouncement presentation={presentation} />
        </>,
      ),
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

  test("uses a quiet fallback when the target is offscreen", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, window.innerHeight + 10, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    expect(projectTargetAttention(presentation, window)).toBeNull();
    act(() =>
      root?.render(<TargetAttentionFallback presentation={presentation} reason="offscreen" />),
    );
    expect(document.querySelector("[data-marimo-lens-target-attention-notice]")?.textContent).toBe(
      "WorkingBYtCUpdating the aggregation.",
    );
  });

  test("uses one contextual activity label across visible and accessible states", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target, "On it");
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <>
          <TargetAttentionIndicator view={projectTargetAttention(presentation, window)} />
          <TargetAttentionFallback presentation={presentation} reason="target-unavailable" />
          <TargetAttentionAnnouncement presentation={presentation} />
        </>,
      ),
    );

    expect(
      document.querySelector(
        "[data-marimo-lens-target-attention] [data-marimo-lens-attention-status]",
      )?.textContent,
    ).toBe("On it");
    expect(
      document.querySelector(
        "[data-marimo-lens-target-attention-notice] [data-marimo-lens-attention-status]",
      )?.textContent,
    ).toBe("On it");
    expect(document.querySelector("[data-marimo-lens-target-attention-status]")?.textContent).toBe(
      "On it in cell BYtC. Updating the aggregation.",
    );
  });

  test("uses one contextual reveal label across visible and accessible states", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const message =
      "Updated the aggregation and verified the chart.\nThe regional totals now match the source table.";
    const presentation: TargetAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      label: "Updated chart",
      message,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <>
          <TargetAttentionIndicator view={projectTargetAttention(presentation, window)} />
          <TargetAttentionFallback presentation={presentation} reason="target-unavailable" />
          <TargetAttentionAnnouncement presentation={presentation} />
        </>,
      ),
    );

    expect(
      document.querySelector(
        "[data-marimo-lens-target-attention] [data-marimo-lens-attention-status]",
      )?.textContent,
    ).toBe("Updated chart");
    expect(
      document.querySelector(
        "[data-marimo-lens-target-attention-notice] [data-marimo-lens-attention-status]",
      )?.textContent,
    ).toBe("Updated chart");
    expect(document.querySelector("[data-marimo-lens-attention-message]")?.textContent).toBe(
      message,
    );
    expect(document.querySelector("[data-marimo-lens-target-attention-status]")?.textContent).toBe(
      `Updated chart in cell BYtC. ${message}`,
    );
    expect(document.querySelector("[data-marimo-lens-working-indicator]")).toBeNull();
  });

  test("uses a quiet reveal label when no message is supplied", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation: TargetAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      label: null,
      message: null,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <TargetAttentionIndicator view={projectTargetAttention(presentation, window)} />,
      ),
    );

    expect(document.querySelector("[data-marimo-lens-attention-status]")?.textContent).toBe(
      "Ready",
    );
  });

  test("uses a neutral reveal fallback when a visible label cannot fit", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 160, 400, 240);
    document.body.appendChild(target);
    const presentation: TargetAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      label: null,
      message: null,
    };
    const surface = projectTargetAttentionSurface(presentation, viewport(480, 720), {
      height: 226,
      maxWidth: 400,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(surface.fallback ? <TargetAttentionFallback {...surface.fallback} /> : null),
    );

    expect(document.querySelector("[data-marimo-lens-attention-status]")?.textContent).toBe(
      "Ready",
    );
  });
});

function activityPresentation(target: HTMLElement, label?: string): TargetAttentionPresentation {
  return {
    kind: "activity",
    sequence: 1,
    locator: { kind: "cell", label: "BYtC", resolve: () => target },
    target,
    bounds: target.getBoundingClientRect(),
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
