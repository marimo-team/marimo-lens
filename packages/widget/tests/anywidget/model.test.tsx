import type { AnyModel, RenderProps } from "@anywidget/types";
import type { LensState } from "@marimo-lens/protocol";

import { createRender } from "@anywidget/react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { useLensModel } from "@/anywidget/model";

function ModelProbe() {
  const model = useLensModel(window);
  return <output data-css={model.css} />;
}

const renderProbe = createRender(ModelProbe);
type RenderCleanup = Exclude<Awaited<ReturnType<typeof renderProbe>>, void>;

const unavailable = () => Promise.reject(new Error("Unavailable in this fixture"));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("Lens model", () => {
  test("reads portal styles from anywidget's native CSS trait", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { model, off } = fakeModel();

    const cleanup = mountProbe(container, model);

    try {
      expect(container.querySelector("output")?.dataset.css).toBe(".marimo_lens { color: blue; }");
      off.mockClear();
    } finally {
      act(() => {
        void cleanup();
      });
    }
    expect(off).toHaveBeenCalledWith("msg:custom", expect.any(Function));
  });
});

function mountProbe(container: HTMLElement, model: AnyModel): RenderCleanup {
  const props = {
    model,
    el: container,
    signal: new AbortController().signal,
    host: { getWidget: unavailable, getModel: unavailable },
    experimental: { invoke: unavailable },
  } satisfies RenderProps;
  const rendered = Array<ReturnType<typeof renderProbe>>();
  act(() => {
    rendered.push(renderProbe(props));
  });
  const cleanup = rendered[0];
  if (cleanup instanceof Promise) throw new Error("Expected synchronous widget cleanup");
  if (!cleanup) throw new Error("Expected synchronous widget cleanup");
  return cleanup;
}

function fakeModel() {
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
    ["_css", ".marimo_lens { color: blue; }"],
  ]);
  const off = vi.fn();
  const model = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    on: vi.fn(),
    off,
    save_changes: vi.fn(),
    send: vi.fn(),
    widget_manager: { get_model: unavailable },
  } satisfies AnyModel;
  return { model, off };
}
