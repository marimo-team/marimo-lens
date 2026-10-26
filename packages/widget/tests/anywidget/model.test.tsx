import type { AnyModel, RenderProps } from "@anywidget/types";
import type { ChatRequest, HistoryState, LensState, TargetSelector } from "@marimo-lens/protocol";

import { createRender } from "@anywidget/react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { useLensModel } from "@/anywidget/model";
import { createLensRender } from "@/app/lens-render";

function ModelProbe() {
  const model = useLensModel(window);
  return <output data-css={model.css} data-selector={model.selector ?? ""} />;
}

const renderProbe = createRender(ModelProbe);

function RevisionProbe() {
  const { state, history } = useLensModel(window);
  return <output data-state={state.revision} data-history={history?.total ?? "none"} />;
}

const renderLens = createLensRender(RevisionProbe);
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
      expect(container.querySelector("output")?.dataset.selector).toBe("[data-feedback-target]");
      off.mockClear();
    } finally {
      act(() => {
        void cleanup();
      });
    }
    expect(off).toHaveBeenCalledWith("msg:custom", expect.any(Function));
  });

  test("keeps the last accepted traits through a value that fails to parse", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { model, update } = fakeModel();
    const cleanup = mountProbe(container, model, renderLens);
    const output = () => container.querySelector("output");

    try {
      act(() => update("_state", { revision: "invalid" }));
      act(() => update("_history", { total: -1 }));
      expect(output()?.dataset.state).toBe("0");
      expect(output()?.dataset.history).toBe("0");
      expect(warning).toHaveBeenCalledTimes(2);

      act(() => update("_state", { ...lensState, revision: 2 }));
      act(() => update("_history", { ...historyState, total: 2 }));
      expect(output()?.dataset.state).toBe("2");
      expect(output()?.dataset.history).toBe("2");
    } finally {
      act(() => {
        void cleanup();
      });
      warning.mockRestore();
    }
  });

  test("reads a null History trait as a Lens that shows no History", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { model, update } = fakeModel(null);
    const cleanup = mountProbe(container, model, renderLens);
    const output = () => container.querySelector("output");

    try {
      expect(output()?.dataset.history).toBe("none");
      act(() => update("_history", { total: -1 }));
      expect(output()?.dataset.history).toBe("none");
      expect(warning).toHaveBeenCalledOnce();
      act(() => update("_history", { ...historyState, total: 3 }));
      expect(output()?.dataset.history).toBe("3");
      act(() => update("_history", null));
      expect(output()?.dataset.history).toBe("none");
    } finally {
      act(() => {
        void cleanup();
      });
      warning.mockRestore();
    }
  });
});

function mountProbe(
  container: HTMLElement,
  model: AnyModel,
  render: typeof renderProbe = renderProbe,
): RenderCleanup {
  const props = {
    model,
    el: container,
    signal: new AbortController().signal,
    host: { getWidget: unavailable, getModel: unavailable },
    experimental: { invoke: unavailable },
  } satisfies RenderProps;
  const rendered = Array<ReturnType<typeof renderProbe>>();
  act(() => {
    rendered.push(render(props));
  });
  const cleanup = rendered[0];
  if (cleanup instanceof Promise) throw new Error("Expected synchronous widget cleanup");
  if (!cleanup) throw new Error("Expected synchronous widget cleanup");
  return cleanup;
}

const lensState: LensState = {
  revision: 0,
  nextLabel: "S1",
  currentSelectionId: null,
  selections: [],
};
const historyState: HistoryState = {
  entries: [],
  total: 0,
  record: { status: "saved" },
  cells: [],
};

// Partial records stand in for trait values that fail their contract.
type TraitValue =
  | LensState
  | HistoryState
  | ChatRequest[]
  | TargetSelector
  | { revision: number | string }
  | { total: number };

function fakeModel(history: HistoryState | null = historyState) {
  const values = new Map<string, TraitValue>([
    ["_lens_id", "lens-1"],
    ["_state", lensState],
    ["_history", history],
    ["_chats", []],
    ["_css", ".marimo_lens { color: blue; }"],
    ["_selector", "[data-feedback-target]" satisfies TargetSelector],
  ]);
  const listeners = new Map<string, Set<() => void>>();
  const off = vi.fn((name: string, callback: () => void) => {
    listeners.get(name)?.delete(callback);
  });
  const model = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    on: vi.fn((name: string, callback: () => void) => {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
    }),
    off,
    save_changes: vi.fn(),
    send: vi.fn(),
    widget_manager: { get_model: unavailable },
  } satisfies AnyModel;
  const update = (key: string, value: TraitValue) => {
    values.set(key, value);
    for (const callback of listeners.get(`change:${key}`) ?? []) callback();
  };
  return { model, off, update };
}
