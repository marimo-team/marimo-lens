import type { AnyModel, Experimental, Host, RenderProps } from "@anywidget/types";

import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import widget from "@/widget";

vi.mock("@/app/marimo-lens-content", () => ({
  MarimoLensContent: () => <span data-widget-content>Lens</span>,
}));

const cleanups = new Set<() => void>();

afterEach(() => {
  for (const cleanup of cleanups) act(() => cleanup());
  cleanups.clear();
  document.body.replaceChildren();
});

describe("Lens widget views", () => {
  test("treats repeated renders of one model as conflicting displayed views", () => {
    const underlyingModel = {};
    const firstContainer = appendContainer();
    const secondContainer = appendContainer();

    const releaseFirst = renderWidget(firstContainer, new Proxy(underlyingModel, {}));
    const releaseSecond = renderWidget(secondContainer, new Proxy(underlyingModel, {}));

    expect(firstContainer.querySelector("[data-widget-content]")).not.toBeNull();
    expect(secondContainer.querySelector("[data-widget-content]")).toBeNull();
    expect(secondContainer.querySelector("[data-marimo-lens-view-conflict]")).not.toBeNull();

    release(releaseFirst);
    expect(secondContainer.querySelector("[data-widget-content]")).not.toBeNull();
    expect(secondContainer.querySelector("[data-marimo-lens-view-conflict]")).toBeNull();

    release(releaseSecond);
    const nextContainer = appendContainer();
    renderWidget(nextContainer, new Proxy(underlyingModel, {}));
    expect(nextContainer.querySelector("[data-widget-content]")).not.toBeNull();
  });
});

function appendContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

function renderWidget(container: HTMLElement, model: object): () => void {
  if (typeof widget === "function") throw new Error("Expected a widget definition");
  const render = widget.render;
  if (!render) throw new Error("Expected a widget render function");
  const props = {
    model: model as AnyModel,
    el: container,
    signal: new AbortController().signal,
    host: {} as Host,
    experimental: {} as Experimental,
  } satisfies RenderProps;
  let cleanup: void | (() => void) = undefined;
  act(() => {
    cleanup = render(props) as void | (() => void);
  });
  if (typeof cleanup !== "function") throw new Error("Expected synchronous widget cleanup");
  cleanups.add(cleanup);
  return cleanup;
}

function release(cleanup: () => void): void {
  act(() => cleanup());
  cleanups.delete(cleanup);
}
