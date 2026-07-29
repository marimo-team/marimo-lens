import type { CellActivityEvent, CellRevealEvent } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";

import type { CellAttentionPresentation } from "@/transient/cell-attention";

import {
  CellAttentionAnnouncement,
  CellAttentionFallback,
  CellAttentionIndicator,
  projectCellAttention,
} from "@/transient/cell-attention-indicator";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("cell attention presentation", () => {
  test("projects a visible target and clamps its label to the viewport", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(980, 40, 200, 160);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);

    const view = projectCellAttention(presentation, window);

    expect(view?.ring).toMatchObject({ top: 40, left: 980, width: 200, height: 160 });
    expect(view?.label.right).toBe(12);
    expect(view?.label.maxWidth).toBe(480);
    expect(view?.label.top).toBe(48);
  });

  test("anchors an above-target label by its bottom edge", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const ownerWindow = { innerWidth: 1280, innerHeight: 720 } as Window;

    const view = projectCellAttention(activityPresentation(target), ownerWindow);

    expect(view?.label.bottom).toBe(428);
    expect(view?.label.top).toBeUndefined();
  });

  test("reserves more vertical space for a long reveal message", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 300, 400, 240);
    document.body.appendChild(target);
    const presentation: CellAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      event: revealEvent("A".repeat(300)),
    };
    const ownerWindow = { innerWidth: 1280, innerHeight: 720 } as Window;

    const view = projectCellAttention(presentation, ownerWindow);

    expect(view?.label.top).toBe(308);
    expect(view?.label.bottom).toBeUndefined();
  });

  test("shrinks a left-anchored label to the remaining narrow viewport", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(190, 80, 80, 160);
    document.body.appendChild(target);
    const narrowWindow = { innerWidth: 480, innerHeight: 720 } as Window;

    const view = projectCellAttention(activityPresentation(target), narrowWindow);

    expect(view?.label.left).toBe(198);
    expect(view?.label.maxWidth).toBe(270);
  });

  test("renders one capture-safe indicator and one stable live announcement", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation = activityPresentation(target);
    const view = projectCellAttention(presentation, window);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <>
          <CellAttentionIndicator view={view} />
          <CellAttentionAnnouncement presentation={presentation} />
        </>,
      ),
    );

    const indicator = document.querySelector<HTMLElement>("[data-marimo-lens-cell-attention]");
    expect(indicator?.dataset.marimoLensUi).toBe("true");
    expect(indicator?.querySelector(".ml-cell-attention__status")?.textContent).toBe("Working");
    expect(indicator?.querySelector(".ml-cell-attention__message")?.textContent).toBe(
      "Updating the aggregation.",
    );
    expect(indicator?.querySelector(".ml-cell-attention__cell")?.textContent).toBe("BYtC");
    expect(indicator?.querySelector("[data-marimo-lens-working-indicator]")).not.toBeNull();
    expect(document.querySelector("[data-marimo-lens-cell-attention-status]")?.textContent).toBe(
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

    expect(projectCellAttention(presentation, window)).toBeNull();
    act(() => root?.render(<CellAttentionFallback presentation={presentation} />));
    expect(document.querySelector("[data-marimo-lens-cell-attention-notice]")?.textContent).toBe(
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
          <CellAttentionIndicator view={projectCellAttention(presentation, window)} />
          <CellAttentionFallback presentation={presentation} />
          <CellAttentionAnnouncement presentation={presentation} />
        </>,
      ),
    );

    expect(document.querySelector(".ml-cell-attention__status")?.textContent).toBe("On it");
    expect(document.querySelector(".ml-cell-attention-notice__status")?.textContent).toBe("On it");
    expect(document.querySelector("[data-marimo-lens-cell-attention-status]")?.textContent).toBe(
      "On it in cell BYtC. Updating the aggregation.",
    );
  });

  test("gives a long reveal message its own detail row", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const message =
      "Updated the aggregation and verified the chart.\nThe regional totals now match the source table.";
    const presentation: CellAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      event: revealEvent(message),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(<CellAttentionIndicator view={projectCellAttention(presentation, window)} />),
    );

    expect(document.querySelector(".ml-cell-attention__status")?.textContent).toBe("Ready");
    expect(document.querySelector(".ml-cell-attention__message")?.textContent).toBe(message);
    expect(document.querySelector("[data-marimo-lens-working-indicator]")).toBeNull();
  });

  test("uses a quiet reveal label when no message is supplied", () => {
    const target = document.createElement("section");
    target.getBoundingClientRect = () => new DOMRect(20, 80, 400, 240);
    document.body.appendChild(target);
    const presentation: CellAttentionPresentation = {
      ...activityPresentation(target),
      kind: "reveal",
      event: {
        ...revealEvent(),
        payload: { cellId: "BYtC" },
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(<CellAttentionIndicator view={projectCellAttention(presentation, window)} />),
    );

    expect(document.querySelector(".ml-cell-attention__status")?.textContent).toBe("Ready");
  });
});

function activityPresentation(target: HTMLElement, label?: string): CellAttentionPresentation {
  return {
    kind: "activity",
    event: activityEvent(label),
    sequence: 1,
    target,
    expiresAt: null,
    phase: "active",
  };
}

function activityEvent(label?: string): CellActivityEvent {
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "cell.activity",
    revision: 7,
    payload: {
      cellId: "BYtC",
      ...(label ? { label } : {}),
      message: "Updating the aggregation.",
    },
  };
}

function revealEvent(message = "Updated the aggregation."): CellRevealEvent {
  return {
    protocol: "marimo-lens.event",
    version: 1,
    type: "cell.reveal",
    revision: 7,
    payload: { cellId: "BYtC", message },
  };
}
