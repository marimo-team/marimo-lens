import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { useLensModel } from "@/anywidget/model";

const mocks = vi.hoisted(() => ({
  model: {
    on: vi.fn(),
    off: vi.fn(),
    get: vi.fn(),
  },
  useModelState: vi.fn((key: string) => {
    if (key === "_css") return [".marimo_lens { color: blue; }", vi.fn()];
    return [
      {
        revision: 0,
        nextLabel: "S1",
        currentSelectionId: null,
        selections: [],
        history: [],
      },
      vi.fn(),
    ];
  }),
}));

vi.mock("@anywidget/react", () => ({
  useModel: () => mocks.model,
  useModelState: mocks.useModelState,
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("Lens model", () => {
  test("reads portal styles from anywidget's native CSS trait", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe() {
      const model = useLensModel(window);
      return <output data-css={model.css} />;
    }

    act(() => root.render(<Probe />));

    expect(container.querySelector("output")?.dataset.css).toBe(".marimo_lens { color: blue; }");
    expect(mocks.useModelState).toHaveBeenCalledWith("_css");

    act(() => root.unmount());
    expect(mocks.model.off).toHaveBeenCalledWith("msg:custom", expect.any(Function));
  });
});
