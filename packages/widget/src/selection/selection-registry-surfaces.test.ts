import { describe, expect, test } from "vite-plus/test";

import { resolveElementSelection } from "@/selection/selection-registry";
import {
  documentTarget,
  interactiveTarget,
  mediaTarget,
  setRect,
} from "@/selection/selection-registry-fixtures";

describe("resolveElementSelection media, document, and control surfaces", () => {
  test("resolves coarse media targets without adding per-mime target kinds", () => {
    document.body.innerHTML = `<figure><img alt="chart snapshot" src="/demo.png" /></figure>`;
    const image = document.querySelector("img")!;
    setRect(image, { height: 120, width: 180, x: 20, y: 30 });

    const resolved = resolveElementSelection(image, [mediaTarget]);

    expect(resolved?.selection?.adapter).toBe("media");
    expect(resolved?.selection?.kind).toBe("media-surface");
    expect(resolved?.target.kind).toBe("media");
  });

  test("resolves document surfaces separately from media", () => {
    document.body.innerHTML = `<object data="/report.pdf" type="application/pdf"></object>`;
    const object = document.querySelector("object")!;
    setRect(object, { height: 320, width: 240, x: 20, y: 30 });

    const resolved = resolveElementSelection(object, [documentTarget]);

    expect(resolved?.selection?.adapter).toBe("document");
    expect(resolved?.selection?.kind).toBe("document-surface");
    expect(resolved?.target.kind).toBe("document");
  });

  test("resolves document surfaces from the point when iframe events hit a wrapper", () => {
    document.body.innerHTML = `
      <section id="output-document-cell">
        <div class="output block">
          <iframe data-marimo-document title="Inline review document"></iframe>
        </div>
      </section>
    `;
    const wrapper = document.querySelector(".output")!;
    const iframe = document.querySelector("iframe")!;
    setRect(wrapper, { height: 240, width: 420, x: 20, y: 30 });
    setRect(iframe, { height: 180, width: 360, x: 40, y: 50 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [wrapper, iframe];

    try {
      const resolved = resolveElementSelection(
        wrapper,
        [
          {
            ...documentTarget,
            id: "var:document_output",
            variable: "document_output",
            label: "document_output",
            cellId: "document-cell",
            displayCellIds: ["document-cell"],
          },
          {
            ...documentTarget,
            id: "output:document-cell",
            variable: undefined,
            label: "Output from cell document-cell",
            kind: "output",
            cellId: "document-cell",
            displayCellIds: ["document-cell"],
          },
        ],
        { x: 80, y: 80 },
      );

      expect(resolved?.selection?.adapter).toBe("document");
      expect(resolved?.target.id).toBe("var:document_output");
      expect(resolved?.element).toBe(iframe);
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("falls back to a same-cell document target when iframe clicks do not bubble", () => {
    document.body.innerHTML = `
      <section id="output-document-cell">
        <div class="output block">Inline review document</div>
      </section>
    `;
    const wrapper = document.querySelector(".output")!;
    setRect(wrapper, { height: 240, width: 420, x: 20, y: 30 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [wrapper];

    try {
      const resolved = resolveElementSelection(
        wrapper,
        [
          {
            ...documentTarget,
            id: "var:document_output",
            variable: "document_output",
            label: "document_output",
            cellId: "document-cell",
            displayCellIds: ["document-cell"],
          },
          {
            ...documentTarget,
            id: "output:document-cell",
            variable: undefined,
            label: "Output from cell document-cell",
            kind: "output",
            cellId: "document-cell",
            displayCellIds: ["document-cell"],
          },
        ],
        { x: 80, y: 80 },
      );

      expect(resolved?.selection?.adapter).toBe("document");
      expect(resolved?.target.id).toBe("var:document_output");
      expect(resolved?.context).toMatchObject({
        displayCellId: "document-cell",
        surface: "document",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("resolves non-columnar interactive controls through a real surface", () => {
    document.body.innerHTML = `
      <section id="output-controls">
        <marimo-slider>
          <label>Limit</label>
          <input type="range" aria-label="Limit" />
        </marimo-slider>
      </section>
    `;
    const input = document.querySelector("input")!;
    setRect(input, { height: 24, width: 160, x: 20, y: 30 });

    const resolved = resolveElementSelection(input, [interactiveTarget]);

    expect(resolved?.selection?.adapter).toBe("interactive");
    expect(resolved?.target.id).toBe("var:limit");
    expect(resolved?.element.tagName.toLowerCase()).toBe("input");
    expect(resolved?.context).toMatchObject({
      component: "marimo-slider",
      surface: "interactive",
    });
  });

  test("prefers an interactive variable over its same-cell output target", () => {
    document.body.innerHTML = `
      <section id="output-control-cell">
        <marimo-slider>
          <label>Revenue floor</label>
          <input type="range" aria-label="Revenue floor" />
        </marimo-slider>
      </section>
    `;
    const input = document.querySelector("input")!;
    setRect(input, { height: 24, width: 160, x: 20, y: 30 });

    const resolved = resolveElementSelection(input, [
      {
        ...interactiveTarget,
        id: "var:revenue_floor",
        variable: "revenue_floor",
        label: "revenue_floor",
        cellId: "control-cell",
        displayCellIds: ["control-cell"],
      },
      {
        ...interactiveTarget,
        id: "output:control-cell",
        variable: undefined,
        label: "Output from cell control-cell",
        kind: "output",
        cellId: "control-cell",
        displayCellIds: ["control-cell"],
      },
    ]);

    expect(resolved?.selection?.adapter).toBe("interactive");
    expect(resolved?.target.id).toBe("var:revenue_floor");
    expect(resolved?.context).toMatchObject({
      component: "marimo-slider",
      interactiveRole: "input",
    });
  });

  test("resolves marimo control host clicks to the control variable", () => {
    document.body.innerHTML = `
      <section id="output-control-cell">
        <marimo-dropdown aria-label="Region">All</marimo-dropdown>
      </section>
    `;
    const host = document.querySelector("marimo-dropdown")!;
    setRect(host, { height: 34, width: 180, x: 20, y: 30 });

    const resolved = resolveElementSelection(host, [
      {
        ...interactiveTarget,
        id: "var:region_filter",
        variable: "region_filter",
        label: "region_filter",
        component: "marimo-dropdown",
        cellId: "control-cell",
        displayCellIds: ["control-cell"],
      },
      {
        ...interactiveTarget,
        id: "output:control-cell",
        variable: undefined,
        label: "Output from cell control-cell",
        kind: "output",
        component: "marimo-dropdown",
        cellId: "control-cell",
        displayCellIds: ["control-cell"],
      },
    ]);

    expect(resolved?.selection?.adapter).toBe("interactive");
    expect(resolved?.target.id).toBe("var:region_filter");
    expect(resolved?.context).toMatchObject({
      component: "marimo-dropdown",
      interactiveRole: "marimo-dropdown",
    });
  });

  test("resolves marimo control hits from the point when the event target is a wrapper", () => {
    document.body.innerHTML = `
      <section id="output-control-cell">
        <div class="output block">
          <marimo-checkbox aria-label="Show margin">Show margin</marimo-checkbox>
        </div>
      </section>
    `;
    const wrapper = document.querySelector(".output")!;
    const host = document.querySelector("marimo-checkbox")!;
    setRect(wrapper, { height: 80, width: 220, x: 10, y: 20 });
    setRect(host, { height: 24, width: 140, x: 24, y: 32 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [wrapper, host];

    try {
      const resolved = resolveElementSelection(
        wrapper,
        [
          {
            ...interactiveTarget,
            id: "var:show_margin",
            variable: "show_margin",
            label: "show_margin",
            component: "marimo-checkbox",
            cellId: "control-cell",
            displayCellIds: ["control-cell"],
          },
          {
            ...interactiveTarget,
            id: "output:control-cell",
            variable: undefined,
            label: "Output from cell control-cell",
            kind: "output",
            component: "marimo-checkbox",
            cellId: "control-cell",
            displayCellIds: ["control-cell"],
          },
        ],
        { x: 40, y: 42 },
      );

      expect(resolved?.selection?.adapter).toBe("interactive");
      expect(resolved?.target.id).toBe("var:show_margin");
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("falls back to a same-cell control target when the event stack misses the host", () => {
    document.body.innerHTML = `
      <section id="output-control-cell">
        <div class="output block">Show margin</div>
      </section>
    `;
    const wrapper = document.querySelector(".output")!;
    setRect(wrapper, { height: 80, width: 220, x: 10, y: 20 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [wrapper];

    try {
      const resolved = resolveElementSelection(
        wrapper,
        [
          {
            ...interactiveTarget,
            id: "var:show_margin",
            variable: "show_margin",
            label: "show_margin",
            component: "marimo-checkbox",
            cellId: "control-cell",
            displayCellIds: ["control-cell"],
          },
          {
            ...interactiveTarget,
            id: "output:control-cell",
            variable: undefined,
            label: "Output from cell control-cell",
            kind: "output",
            component: "marimo-checkbox",
            cellId: "control-cell",
            displayCellIds: ["control-cell"],
          },
        ],
        { x: 40, y: 42 },
      );

      expect(resolved?.selection?.adapter).toBe("interactive");
      expect(resolved?.target.id).toBe("var:show_margin");
      expect(resolved?.context).toMatchObject({
        component: "marimo-checkbox",
        displayCellId: "control-cell",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });
});
