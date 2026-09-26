import type { AnyModel, Experimental, Host, RenderProps } from "@anywidget/types";
import type { LensState } from "@marimo-lens/protocol";

import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { createLensRender } from "@/app/lens-render";

const render = createLensRender(TestContent);

type RenderCleanup = Exclude<Awaited<ReturnType<typeof render>>, void>;

const cleanups = new Set<RenderCleanup>();

afterEach(() => {
  for (const cleanup of cleanups) {
    act(() => {
      void cleanup();
    });
  }
  cleanups.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Lens widget views", () => {
  test("renders controls in one view and transfers ownership after teardown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const underlyingModel = fakeModel();
    const firstContainer = appendContainer();
    const secondContainer = appendContainer();

    const releaseFirst = renderWidget(firstContainer, new Proxy(underlyingModel, {}));
    const releaseSecond = renderWidget(secondContainer, new Proxy(underlyingModel, {}));

    expect(firstContainer.querySelector("[data-widget-content]")).not.toBeNull();
    expect(secondContainer.querySelector("[data-widget-content]")).toBeNull();

    await release(releaseFirst);
    expect(secondContainer.querySelector("[data-widget-content]")).not.toBeNull();

    await release(releaseSecond);
    const nextContainer = appendContainer();
    renderWidget(nextContainer, new Proxy(underlyingModel, {}));
    expect(nextContainer.querySelector("[data-widget-content]")).not.toBeNull();
  });
});

function TestContent() {
  return <span data-widget-content>Lens</span>;
}

function appendContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

function renderWidget(container: HTMLElement, model: AnyModel): RenderCleanup {
  const props = {
    model,
    el: container,
    signal: new AbortController().signal,
    host: fakeHost(),
    experimental: fakeExperimental(),
  } satisfies RenderProps;
  const rendered = Array<ReturnType<typeof render>>();
  act(() => {
    rendered.push(render(props));
  });
  const cleanup = rendered[0];
  if (cleanup instanceof Promise) throw new Error("Expected synchronous widget cleanup");
  if (!cleanup) throw new Error("Expected synchronous widget cleanup");
  cleanups.add(cleanup);
  return cleanup;
}

async function release(cleanup: RenderCleanup): Promise<void> {
  // Ownership moves to the next view after the releasing task.
  await act(async () => {
    void cleanup();
  });
  cleanups.delete(cleanup);
}

function fakeModel(): AnyModel {
  const values = new Map<string, LensState | string>([
    [
      "_state",
      {
        revision: 0,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
    ],
    ["_css", ""],
  ]);
  const model: AnyModel = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    on: () => undefined,
    off: () => undefined,
    save_changes: () => undefined,
    send: () => undefined,
    widget_manager: {
      get_model: () => Promise.reject(new Error("Nested models are unavailable in this fixture")),
    },
  };
  return model;
}

function fakeHost(): Host {
  return {
    getWidget: () => Promise.reject(new Error("Nested widgets are unavailable in this fixture")),
    getModel: () => Promise.reject(new Error("Nested models are unavailable in this fixture")),
  };
}

function fakeExperimental(): Experimental {
  return {
    invoke: () => Promise.reject(new Error("Host invocation is unavailable in this fixture")),
  };
}
