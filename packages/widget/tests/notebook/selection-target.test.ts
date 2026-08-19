import { afterEach, describe, expect, test } from "vite-plus/test";

import { registerLensHostOutput } from "@/notebook/output-root";
import {
  getTargetSurface,
  listTargetSurfaces,
  targetBelongsToDocument,
  targetFromElement,
  validateTargetSelector,
} from "@/notebook/selection-target";

afterEach(() => document.body.replaceChildren());

describe("selection targets", () => {
  test("keeps notebook targeting on canonical output roots by default", () => {
    const output = visible(document.createElement("div"));
    output.id = "output-cell-1";
    const mark = document.createElement("span");
    output.appendChild(mark);
    document.body.appendChild(output);

    const target = targetFromElement(mark, null);

    expect(target?.target).toEqual({ kind: "notebook", cellIds: ["cell-1"] });
    expect(target?.element).toBe(output);
  });

  test("lists notebook outputs mounted in an open shadow root", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const output = visible(document.createElement("div"));
    output.id = "output-shadow-cell";
    shadow.appendChild(output);
    document.body.appendChild(host);

    expect(listTargetSurfaces(document, null).map(({ target }) => target)).toEqual([
      { kind: "notebook", cellIds: ["shadow-cell"] },
    ]);
  });

  test("configured roots outrank notebook outputs across open shadow trees", () => {
    const section = visible(document.createElement("section"));
    section.dataset.feedbackTarget = "";
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const output = visible(document.createElement("div"));
    output.id = "output-shadow-cell";
    shadow.appendChild(output);
    section.appendChild(host);
    document.body.appendChild(section);
    const selector = "[data-feedback-target]";

    expect(targetFromElement(output, selector)?.target.kind).toBe("dom");
    expect(listTargetSurfaces(document, selector).map(({ target }) => target.kind)).toEqual([
      "dom",
    ]);
  });

  test("prefers a configured root over its nested notebook renderer", () => {
    const host = visible(document.createElement("section"));
    host.id = "summary-host";
    host.dataset.feedbackTarget = "";
    host.dataset.runtimeCellId = "producer-cell";
    const synthetic = visible(document.createElement("div"));
    synthetic.id = "output-synthetic-cell";
    const mark = document.createElement("span");
    synthetic.appendChild(mark);
    host.appendChild(synthetic);
    document.body.appendChild(host);

    const selector = "[data-feedback-target]";
    const target = targetFromElement(mark, selector);

    expect(target?.target).toEqual({
      kind: "dom",
      cellIds: ["producer-cell"],
      documentPath: "/",
      domSelector: "#summary-host",
    });
    expect(target?.element).toBe(host);
    expect(listTargetSurfaces(document, selector)).toHaveLength(1);
  });

  test("excludes a configured root that renders Lens", () => {
    const host = visible(document.createElement("section"));
    host.dataset.feedbackTarget = "";
    const output = visible(document.createElement("div"));
    output.id = "output-lens-cell";
    const marker = document.createElement("span");
    output.appendChild(marker);
    host.appendChild(output);
    document.body.appendChild(host);
    const release = registerLensHostOutput(marker);

    expect(listTargetSurfaces(document, "[data-feedback-target]")).toEqual([]);
    release();
  });

  test("infers producing cells from generic runtime metadata", () => {
    const section = visible(document.createElement("section"));
    section.id = "forecast-summary";
    section.dataset.feedbackTarget = "";
    const heading = document.createElement("h2");
    const total = document.createElement("strong");
    total.dataset.runtimeCellId = "report-cell";
    const chart = document.createElement("div");
    chart.dataset.runtimeCellId = "chart-cell";
    section.append(heading, total, chart);
    document.body.appendChild(section);

    const target = targetFromElement(heading, "[data-feedback-target]");

    expect(target?.target).toEqual({
      kind: "dom",
      cellIds: ["chart-cell", "report-cell"],
      documentPath: "/",
      domSelector: "#forecast-summary",
    });
  });

  test("treats inferred producer identity as a set", () => {
    const section = visible(document.createElement("section"));
    section.id = "forecast-summary";
    section.dataset.feedbackTarget = "";
    const first = document.createElement("span");
    first.dataset.runtimeCellId = "cell-a";
    const second = document.createElement("span");
    second.dataset.runtimeCellId = "cell-b";
    section.append(first, second);
    document.body.appendChild(section);
    const selector = "[data-feedback-target]";
    const target = targetFromElement(section, selector)!.target;

    section.prepend(second);

    expect(getTargetSurface(document, target, selector)?.element).toBe(section);
  });

  test("detaches when eligibility or producer identity changes", () => {
    const section = visible(document.createElement("section"));
    section.id = "forecast-summary";
    section.dataset.feedbackTarget = "";
    section.dataset.runtimeCellId = "report-cell";
    document.body.appendChild(section);
    const selector = "[data-feedback-target]";
    const target = targetFromElement(section, selector)!.target;

    expect(getTargetSurface(document, target, selector)?.element).toBe(section);
    section.dataset.runtimeCellId = "next-cell";
    expect(getTargetSurface(document, target, selector)).toBeNull();
    section.dataset.runtimeCellId = "report-cell";
    delete section.dataset.feedbackTarget;
    expect(getTargetSurface(document, target, selector)).toBeNull();
  });

  test("rejects an invalid configured DOM selector", () => {
    expect(() => validateTargetSelector(document, "[")).toThrow("Lens dom_selector is invalid");
    expect(
      getTargetSurface(
        document,
        { kind: "dom", cellIds: [], documentPath: "/", domSelector: "[" },
        "*",
      ),
    ).toBeNull();
  });

  test("scopes DOM targets to their originating document", () => {
    const target = {
      kind: "dom" as const,
      cellIds: [],
      documentPath: "/another-view/",
      domSelector: "#forecast-summary",
    };

    expect(targetBelongsToDocument(target, document)).toBe(false);
    expect(getTargetSurface(document, target, "*")).toBeNull();
  });

  test("skips roots whose exact selector cannot fit the protocol", () => {
    let parent: HTMLElement = document.body;
    for (let index = 0; index < 260; index += 1) {
      const child = document.createElement("div");
      parent.appendChild(child);
      parent = child;
    }
    visible(parent).dataset.feedbackTarget = "";

    expect(targetFromElement(parent, "[data-feedback-target]")).toBeNull();
    expect(listTargetSurfaces(document, "[data-feedback-target]")).toEqual([]);
  });

  test("falls back to a structural locator when an element ID is too long", () => {
    const section = visible(document.createElement("section"));
    section.id = "x".repeat(1_025);
    section.dataset.feedbackTarget = "";
    document.body.appendChild(section);

    const target = targetFromElement(section, "[data-feedback-target]");

    expect(target?.target).toMatchObject({
      kind: "dom",
      domSelector: "body > section",
    });
  });

  test("skips roots whose producer list exceeds its bound", () => {
    const section = visible(document.createElement("section"));
    section.dataset.feedbackTarget = "";
    for (let index = 0; index < 65; index += 1) {
      const producer = document.createElement("span");
      producer.dataset.runtimeCellId = `cell-${index}`;
      section.appendChild(producer);
    }
    document.body.appendChild(section);

    expect(targetFromElement(section, "[data-feedback-target]")).toBeNull();
    expect(listTargetSurfaces(document, "[data-feedback-target]")).toEqual([]);
  });

  test("skips roots with producer IDs outside the protocol bound", () => {
    const section = visible(document.createElement("section"));
    section.dataset.feedbackTarget = "";
    section.dataset.runtimeCellId = "x".repeat(129);
    document.body.appendChild(section);

    expect(targetFromElement(section, "[data-feedback-target]")).toBeNull();
  });

  test("skips roots whose document path exceeds the protocol bound", () => {
    const originalPath = window.location.pathname;
    window.history.replaceState(null, "", `/${"x".repeat(1_025)}`);
    try {
      const section = visible(document.createElement("section"));
      section.dataset.feedbackTarget = "";
      document.body.appendChild(section);

      expect(targetFromElement(section, "[data-feedback-target]")).toBeNull();
    } finally {
      window.history.replaceState(null, "", originalPath);
    }
  });
});

function visible<T extends HTMLElement>(element: T): T {
  element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
  return element;
}
