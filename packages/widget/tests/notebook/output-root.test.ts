import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  deepestElementAtPoint,
  getOutputCell,
  listOutputCells,
  outputCellFromElement,
  outputCellFromEvent,
  registerLensHostOutput as registerHost,
} from "@/notebook/output-root";

const hostReleases: Array<() => void> = [];

function registerLensHostOutput(host: Element) {
  const release = registerHost(host);
  hostReleases.push(release);
  return release;
}

afterEach(() => {
  for (const release of hostReleases.splice(0)) release();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

function visibleOutput(id: string): HTMLElement {
  const output = document.createElement("div");
  output.id = `output-${id}`;
  output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
  document.body.appendChild(output);
  return output;
}

function visibleIsland(id: string) {
  const island = document.createElement("marimo-island");
  island.setAttribute("data-cell-id", id);
  const output = document.createElement("div");
  output.className = "output";
  output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 4);
  const content = document.createElement("div");
  content.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
  output.appendChild(content);
  island.appendChild(output);
  document.body.appendChild(island);
  return { island, content };
}

describe("marimo output resolution", () => {
  test("keeps output order when shadow and light DOM roots are interleaved", () => {
    const first = visibleOutput("first");
    const host = document.createElement("div");
    first.append(host);
    const nested = visibleOutput("nested");
    host.attachShadow({ mode: "open" }).append(nested);
    const light = visibleOutput("light");
    first.append(light);
    const last = visibleOutput("last");
    expect(listOutputCells(document).map(({ element }) => element)).toEqual([
      first,
      nested,
      light,
      last,
    ]);
  });

  test("resolves the canonical output id across an open shadow root", () => {
    const output = visibleOutput("chart-cell");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const mark = document.createElement("span");
    shadow.appendChild(mark);
    output.appendChild(host);

    expect(outputCellFromElement(mark)).toMatchObject({ id: "chart-cell", element: output });

    const event = new Event("pointerdown", { composed: true });
    Object.defineProperty(event, "composedPath", { value: () => [mark, shadow, host, output] });
    expect(outputCellFromEvent(event)).toMatchObject({ id: "chart-cell", element: output });
  });

  test("excludes the Lens host output from pointer and keyboard discovery", () => {
    const lensOutput = visibleOutput("lens-cell");
    const hostMarker = document.createElement("span");
    hostMarker.setAttribute("data-marimo-lens-host", "");
    lensOutput.appendChild(hostMarker);
    const release = registerLensHostOutput(hostMarker);
    const notebookOutput = visibleOutput("analysis-cell");

    expect(getOutputCell(document, "lens-cell")).toBeNull();
    expect(listOutputCells(document)).toEqual([{ id: "analysis-cell", element: notebookOutput }]);

    release();
    expect(getOutputCell(document, "lens-cell")).toMatchObject({
      id: "lens-cell",
      element: lensOutput,
    });
  });

  test("excludes enclosing outputs until the last nested Lens view is released", () => {
    const outer = visibleOutput("outer");
    const inner = visibleOutput("inner");
    const host = document.createElement("span");
    inner.append(host);
    outer.append(inner);
    const first = registerLensHostOutput(host);
    const second = registerLensHostOutput(host);

    expect(getOutputCell(document, "outer")).toBeNull();
    first();
    expect(getOutputCell(document, "outer")).toBeNull();
    second();
    expect(getOutputCell(document, "outer")?.element).toBe(outer);
    expect(getOutputCell(document, "inner")?.element).toBe(inner);
  });

  test("resolves a hydrated marimo island to its rendered output surface", () => {
    const { island, content } = visibleIsland("island-cell");

    expect(outputCellFromElement(content)).toEqual({ id: "island-cell", element: content });
    expect(getOutputCell(document, "island-cell")).toEqual({
      id: "island-cell",
      element: content,
    });
    expect(listOutputCells(document)).toEqual([{ id: "island-cell", element: content }]);

    const release = registerLensHostOutput(content);
    expect(outputCellFromElement(island)).toBeNull();
    expect(listOutputCells(document)).toEqual([]);
    release();
  });

  test("resolves a marimo island before hydration", () => {
    const island = document.createElement("marimo-island");
    island.setAttribute("data-cell-id", "static-cell");
    const output = document.createElement("marimo-cell-output");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    island.appendChild(output);
    document.body.appendChild(island);

    expect(outputCellFromElement(output)).toEqual({ id: "static-cell", element: output });
  });

  test("keeps a display-contents island wrapper inside the output surface", () => {
    const island = document.createElement("marimo-island");
    island.setAttribute("data-cell-id", "widget-cell");
    const output = document.createElement("div");
    output.className = "output";
    output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    const wrapper = document.createElement("marimo-ui-element");
    wrapper.style.display = "contents";
    output.appendChild(wrapper);
    island.appendChild(output);
    document.body.appendChild(island);

    expect(outputCellFromElement(wrapper)).toEqual({ id: "widget-cell", element: output });
  });

  test("resolves a host-configured output element", () => {
    const output = document.createElement("article");
    output.setAttribute("data-marimo-lens-output-cell-id", "embedded-cell");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    document.body.appendChild(output);

    expect(outputCellFromElement(output)).toEqual({ id: "embedded-cell", element: output });
    expect(getOutputCell(document, "embedded-cell")).toEqual({
      id: "embedded-cell",
      element: output,
    });
  });

  test("excludes a Lens host marker inside an open shadow root", () => {
    const lensOutput = visibleOutput("lens-cell");
    const widget = document.createElement("marimo-anywidget");
    const shadow = widget.attachShadow({ mode: "open" });
    const nestedHost = document.createElement("div");
    const nestedShadow = nestedHost.attachShadow({ mode: "open" });
    const hostMarker = document.createElement("span");
    hostMarker.setAttribute("data-marimo-lens-host", "");
    nestedShadow.appendChild(hostMarker);
    shadow.appendChild(nestedHost);
    lensOutput.appendChild(widget);
    registerLensHostOutput(hostMarker);
    const notebookOutput = visibleOutput("analysis-cell");

    expect(getOutputCell(document, "lens-cell")).toBeNull();
    expect(listOutputCells(document)).toEqual([{ id: "analysis-cell", element: notebookOutput }]);
  });

  test("ignores events originating in Lens UI", () => {
    visibleOutput("cell-1");
    const button = document.createElement("button");
    button.setAttribute("data-marimo-lens-ui", "");
    const event = new Event("pointerdown", { composed: true });
    Object.defineProperty(event, "composedPath", { value: () => [button, document.body] });

    expect(outputCellFromEvent(event)).toBeNull();
  });

  test("skips Lens UI inside an open shadow root when resolving a point", () => {
    const output = visibleOutput("cell-1");
    const detail = document.createElement("span");
    output.appendChild(detail);

    const lensUi = document.createElement("div");
    lensUi.setAttribute("data-marimo-lens-ui", "");
    const shadow = lensUi.attachShadow({ mode: "open" });
    const marker = document.createElement("button");
    shadow.appendChild(marker);
    document.body.appendChild(lensUi);

    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [marker, detail, output],
    });

    expect(deepestElementAtPoint(document, 160, 90)).toBe(detail);
  });

  test("ignores document overlays returned while descending an output shadow root", () => {
    const output = visibleOutput("cell-1");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const canvas = document.createElement("canvas");
    shadow.appendChild(canvas);
    output.appendChild(host);

    const lensUi = document.createElement("div");
    lensUi.setAttribute("data-marimo-lens-ui", "");
    const marker = document.createElement("button");
    lensUi.appendChild(marker);
    document.body.appendChild(lensUi);

    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [marker, host, output],
    });
    Object.defineProperty(shadow, "elementsFromPoint", {
      configurable: true,
      value: () => [marker, canvas, host, output],
    });

    expect(deepestElementAtPoint(document, 160, 90)).toBe(canvas);
  });

  test("does not resolve an output root hidden with display none", () => {
    const output = visibleOutput("hidden-cell");
    output.style.display = "none";

    expect(getOutputCell(document, "hidden-cell")).toBeNull();
    expect(listOutputCells(document)).toEqual([]);
  });

  test("keeps output lookup scoped to the mounted notebook document", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const secondaryDocument = frame.contentDocument!;
    const primary = visibleOutput("shared-cell");
    const secondary = secondaryDocument.createElement("div");
    secondary.id = "output-shared-cell";
    secondary.getBoundingClientRect = () => new DOMRect(0, 0, 640, 320);
    secondaryDocument.body.appendChild(secondary);

    expect(getOutputCell(document, "shared-cell")?.element).toBe(primary);
    expect(getOutputCell(secondaryDocument, "shared-cell")?.element).toBe(secondary);
  });
});
