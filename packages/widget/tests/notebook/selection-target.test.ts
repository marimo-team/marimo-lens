import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { registerLensHostOutput } from "@/notebook/output-root";
import {
  documentIdentity,
  getTargetSurface,
  listTargetSurfaces,
  targetBelongsToDocument,
  targetFromElement,
  validateTargetSelector,
} from "@/notebook/selection-target";

afterEach(() => document.body.replaceChildren());

describe("selection targets", () => {
  test("picks an individual metric field ahead of its summary row", () => {
    const row = visible(document.createElement("section"));
    row.dataset.marimoLensInputs = "summary";
    const summary = document.createElement("span");
    summary.id = "summary";
    summary.dataset.marimoLensCellId = "producer";
    document.body.append(summary, row);
    const targets = ["events", "felt_reports"].map((field) => {
      const card = visible(document.createElement("article"));
      const value = document.createElement("strong");
      value.textContent = "42";
      const input = document.createElement("span");
      input.hidden = true;
      input.dataset.marimoLensCellId = "producer";
      input.dataset.marimoLensSelector = `summary.${field}`;
      card.append(input, value);
      row.append(card);
      return targetFromElement(value, "section, article")!;
    });
    expect(
      targets.map((surface) => surface.target.kind === "dom" && surface.target.sources),
    ).toEqual([
      [{ cellId: "producer", selector: "summary.events" }],
      [{ cellId: "producer", selector: "summary.felt_reports" }],
    ]);
  });

  test("withholds busy contained projections until rendering finishes", () => {
    const region = visible(document.createElement("section"));
    region.id = "revenue";
    const input = document.createElement("span");
    input.hidden = true;

    input.dataset.marimoLensCellId = "summary-cell";
    input.dataset.marimoLensSelector = "summary.revenue";
    region.append(input);
    document.body.append(region);
    const selector = ":has(> [hidden][data-marimo-lens-cell-id])";
    const target = targetFromElement(region, selector)!.target;
    expect(target).toMatchObject({
      cellIds: ["summary-cell"],
      sources: [{ cellId: "summary-cell", selector: "summary.revenue" }],
    });
    const outer = visible(document.createElement("article"));
    region.replaceWith(outer);
    outer.append(region);
    region.setAttribute("aria-busy", "true");
    expect(targetFromElement(region, `${selector}, article`)).toBeNull();
    expect(getTargetSurface(document, target, selector)).toBeNull();
    region.setAttribute("aria-busy", "false");
    expect(getTargetSurface(document, target, selector)?.element).toBe(region);
  });

  test("resolves explicit shared inputs without including unrelated nested projections", () => {
    const region = visible(document.createElement("section"));
    region.dataset.marimoLensInputs = "rows totals rows";
    const input = (id: string, cell: string, target: string) => {
      const host = document.createElement("span");
      host.id = id;
      host.dataset.marimoLensCellId = cell;
      host.dataset.marimoLensSelector = target;
      return host;
    };
    const rows = input("rows", "data-cell", "rows");
    const totals = input("totals", "summary-cell", "summary.total");
    region.append(input("unrelated", "control-cell", "control"));
    document.body.append(region, rows, totals);
    const selector = "[data-marimo-lens-inputs]";
    const target = targetFromElement(region, selector)!.target;
    expect(target).toMatchObject({
      cellIds: ["data-cell", "summary-cell"],
      sources: [
        { cellId: "data-cell", selector: "rows" },
        { cellId: "summary-cell", selector: "summary.total" },
      ],
    });
    // Replacing a framework-owned host with the same declared input preserves attention.
    const replacement = input("totals", "summary-cell", "summary.total");
    totals.replaceWith(replacement);
    expect(getTargetSurface(document, target, selector)?.element).toBe(region);
    replacement.dataset.marimoLensSelector = "summary.cost";
    expect(getTargetSurface(document, target, selector)).toBeNull();
    rows.remove();
    expect(targetFromElement(region, selector)).toBeNull();
  });

  test.each(["", "missing", "duplicate", "region", "unbound"])(
    "rejects an unresolved or ambiguous source reference: %s",
    (reference) => {
      const region = visible(document.createElement("section"));
      region.id = "region";
      region.dataset.marimoLensInputs = reference;
      document.body.innerHTML =
        '<span id="duplicate" data-marimo-lens-cell-id="a"></span>' +
        '<span id="duplicate" data-marimo-lens-cell-id="b"></span><span id="unbound" data-client-value="rows"></span>';
      document.body.append(region);
      expect(targetFromElement(region, "[data-marimo-lens-inputs]")).toBeNull();
    },
  );

  test("resolves selections across separately loaded widget modules in one document", async () => {
    const output = visible(document.createElement("div"));
    output.id = "output-shared-cell";
    document.body.appendChild(output);
    const target = targetFromElement(output, null)!.target;

    vi.resetModules();
    const nextModule = await import("@/notebook/selection-target");

    expect(nextModule.getTargetSurface(document, target, null)?.element).toBe(output);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    expect(nextModule.targetBelongsToDocument(target, frame.contentDocument!)).toBe(false);
  });

  test("keeps notebook targeting on canonical output roots by default", () => {
    const output = visible(document.createElement("div"));
    output.id = "output-cell-1";
    const mark = document.createElement("span");
    output.appendChild(mark);
    document.body.appendChild(output);

    const target = targetFromElement(mark, null);

    expect(target?.target).toEqual({
      kind: "notebook",
      cellIds: ["cell-1"],
      documentId: documentIdentity(document),
      documentPath: "/",
    });
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
      {
        kind: "notebook",
        cellIds: ["shadow-cell"],
        documentId: documentIdentity(document),
        documentPath: "/",
      },
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
    host.dataset.marimoLensCellId = "producer-cell";
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
      sources: [{ cellId: "producer-cell", selector: null }],
      cellIds: ["producer-cell"],
      documentId: documentIdentity(document),
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
    total.dataset.marimoLensCellId = "report-cell";
    const chart = document.createElement("div");
    chart.dataset.marimoLensCellId = "chart-cell";
    section.append(heading, total, chart);
    document.body.appendChild(section);

    const target = targetFromElement(heading, "[data-feedback-target]");

    expect(target?.target).toEqual({
      kind: "dom",
      sources: [
        { cellId: "chart-cell", selector: null },
        { cellId: "report-cell", selector: null },
      ],
      cellIds: ["chart-cell", "report-cell"],
      documentId: documentIdentity(document),
      documentPath: "/",
      domSelector: "#forecast-summary",
    });
  });

  test("treats inferred producer identity as a set", () => {
    const section = visible(document.createElement("section"));
    section.id = "forecast-summary";
    section.dataset.feedbackTarget = "";
    const first = document.createElement("span");
    first.dataset.marimoLensCellId = "cell-a";
    const second = document.createElement("span");
    second.dataset.marimoLensCellId = "cell-b";
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
    section.dataset.marimoLensCellId = "report-cell";
    document.body.appendChild(section);
    const selector = "[data-feedback-target]";
    const target = targetFromElement(section, selector)!.target;

    expect(getTargetSurface(document, target, selector)?.element).toBe(section);
    section.dataset.marimoLensCellId = "next-cell";
    expect(getTargetSurface(document, target, selector)).toBeNull();
    section.dataset.marimoLensCellId = "report-cell";
    delete section.dataset.feedbackTarget;
    expect(getTargetSurface(document, target, selector)).toBeNull();
  });

  test("rejects an invalid configured DOM selector", () => {
    expect(() => validateTargetSelector(document, "[")).toThrow("Lens dom_selector is invalid");
    expect(
      getTargetSurface(
        document,
        {
          kind: "dom",
          sources: [],
          cellIds: [],
          documentId: documentIdentity(document),
          documentPath: "/",
          domSelector: "[",
        },
        "*",
      ),
    ).toBeNull();
  });

  test("requires both the originating document ID and path", () => {
    const section = visible(document.createElement("section"));
    section.id = "forecast-summary";
    document.body.appendChild(section);
    const current = {
      kind: "dom" as const,
      sources: [],
      cellIds: [],
      documentId: documentIdentity(document),
      documentPath: document.location.pathname || "/",
      domSelector: "#forecast-summary",
    };
    expect(getTargetSurface(document, current, "*")?.element).toBe(section);

    for (const target of [
      { ...current, documentId: "another-document" },
      { ...current, documentPath: "/another-view/" },
    ]) {
      expect(targetBelongsToDocument(target, document)).toBe(false);
      expect(getTargetSurface(document, target, "*")).toBeNull();
    }
  });

  test("creates a stable document identity when randomUUID is unavailable", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument!;
    const ownerWindow = frame.contentWindow!;
    Object.defineProperty(ownerWindow.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    const section = visible(ownerDocument.createElement("section"));
    section.dataset.feedbackTarget = "";
    ownerDocument.body.appendChild(section);

    const surface = targetFromElement(section, "[data-feedback-target]");

    expect(surface?.element).toBe(section);
    expect(documentIdentity(ownerDocument)).toBe(surface?.target.documentId);
  });

  test("preserves unkeyed attention across moves but not element replacement", () => {
    const parent = visible(document.createElement("section"));
    parent.dataset.feedbackTarget = "";
    document.body.append(parent);
    const target = targetFromElement(parent, "[data-feedback-target]")!.target;
    const container = document.createElement("article");
    document.body.append(container);
    container.append(parent);
    expect(getTargetSurface(document, target, "[data-feedback-target]")?.element).toBe(parent);
    const replacement = visible(document.createElement("div"));
    for (const attribute of parent.attributes)
      replacement.setAttribute(attribute.name, attribute.value);
    parent.replaceWith(replacement);
    expect(getTargetSurface(document, target, "[data-feedback-target]")).toBeNull();
  });

  test("assigns an element lifetime locator when an element ID is too long", () => {
    const section = visible(document.createElement("section"));
    section.id = "x".repeat(1_025);
    section.dataset.feedbackTarget = "";
    document.body.appendChild(section);

    const target = targetFromElement(section, "[data-feedback-target]");

    expect(target?.target.kind).toBe("dom");
    expect(getTargetSurface(document, target!.target, "[data-feedback-target]")?.element).toBe(
      section,
    );
  });

  test("skips roots whose producer list exceeds its bound", () => {
    const section = visible(document.createElement("section"));
    section.dataset.feedbackTarget = "";
    for (let index = 0; index < 65; index += 1) {
      const producer = document.createElement("span");
      producer.dataset.marimoLensCellId = `cell-${index}`;
      section.appendChild(producer);
    }
    document.body.appendChild(section);

    expect(targetFromElement(section, "[data-feedback-target]")).toBeNull();
    expect(listTargetSurfaces(document, "[data-feedback-target]")).toEqual([]);
  });

  test("skips roots with producer IDs outside the protocol bound", () => {
    const section = visible(document.createElement("section"));
    section.dataset.feedbackTarget = "";
    section.dataset.marimoLensCellId = "x".repeat(129);
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
