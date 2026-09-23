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
import { collectDomHint } from "@/selection/dom-hint";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("selection targets", () => {
  test.each(["Only text", "<span data-marimo-lens-target hidden></span>"])(
    "lists the scope itself when descendants provide no broad roots: %s",
    (content) => {
      const scope = visible(document.createElement("section"));
      scope.id = "scope";
      scope.dataset.marimoLensScope = "article";
      scope.innerHTML = content;
      document.body.append(scope);
      const picked = targetFromElement(scope, null)!;
      expect(picked.target).toMatchObject({ kind: "dom", domSelector: "#scope" });
      expect(listTargetSurfaces(document, null)).toEqual([picked]);
      expect(getTargetSurface(document, picked.target, null)?.element).toBe(scope);
    },
  );

  test("unsupported :has selectors preserve native, custom, and scoped picking", () => {
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
      if (selector.includes(":has(")) throw new DOMException("Unsupported :has", "SyntaxError");
      return matches.call(this, selector);
    });
    const query = Document.prototype.querySelectorAll;
    vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(
      function (this: Document, selector) {
        if (selector.includes(":has(")) throw new DOMException("Unsupported :has", "SyntaxError");
        return query.call(this, selector);
      },
    );
    document.body.innerHTML =
      '<div id="output-native">Native</div><section id="custom">Custom</section><main id="scope" data-marimo-lens-scope="article"><article id="card"><span>Text</span></article></main>';
    const native = visible(document.getElementById("output-native")!);
    const custom = visible(document.getElementById("custom")!);
    const scope = visible(document.getElementById("scope")!);
    const card = visible(document.getElementById("card")!);
    expect(targetFromElement(native, null)?.target.kind).toBe("notebook");
    expect(targetFromElement(custom, "#custom")?.element).toBe(custom);
    const picked = targetFromElement(card.firstElementChild, null)!;
    expect(picked.element).toBe(card);
    expect(getTargetSurface(document, picked.target, null)?.element).toBe(card);
    expect(listTargetSurfaces(document, "#custom").map(({ element }) => element)).toEqual([
      native,
      custom,
      scope,
      card,
    ]);
  });

  test("the nearest declared region wins inside another declared region", () => {
    document.body.innerHTML =
      '<section id="outer" data-marimo-lens-target><article id="inner" data-marimo-lens-inputs="source"><em>Detail</em></article></section><span id="source" hidden data-marimo-lens-cell-id="producer"></span>';
    const outer = visible(document.getElementById("outer")!);
    const inner = visible(document.getElementById("inner")!);
    expect(targetFromElement(inner.firstElementChild, null)?.element).toBe(inner);
    expect(targetFromElement(outer, null)?.element).toBe(outer);
  });

  test("discovery rechecks changed and duplicate source IDs on every read", () => {
    const region = visible(document.createElement("article"));
    region.id = "metric";
    region.dataset.marimoLensInputs = "input";
    const input = document.createElement("span");
    input.id = "input";
    input.hidden = true;
    input.dataset.marimoLensCellId = "first";
    document.body.append(region, input);
    const targets = () => listTargetSurfaces(document, "article");
    expect(targets()[0]?.target.cellIds).toEqual(["first"]);
    input.dataset.marimoLensCellId = "second";
    expect(targets()[0]?.target.cellIds).toEqual(["second"]);
    const duplicate = input.cloneNode(true);
    document.body.append(duplicate);
    expect(targets()).toEqual([]);
    document.body.removeChild(duplicate);
    expect(targets()[0]?.target.cellIds).toEqual(["second"]);
  });

  test("nested scope policies stay independent and refresh between discoveries", () => {
    document.body.innerHTML =
      '<main data-marimo-lens-scope="article"><article id="outer"><div id="inner" data-marimo-lens-scope=".group"><section id="panel" class="group"><p id="text">Text</p></section></div></article></main>';
    const outer = visible(document.getElementById("outer")!);
    const inner = visible(document.getElementById("inner")!);
    const panel = visible(document.getElementById("panel")!);
    const text = visible(document.getElementById("text")!);
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([
      outer,
      inner,
      panel,
    ]);
    panel.className = "";
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([
      outer,
      inner,
      panel,
      text,
    ]);
    expect(targetFromElement(text, null)?.element).toBe(text);
    panel.className = "group";
    expect(targetFromElement(text, null)?.element).toBe(panel);
  });

  test("discovers nested groups and their picked children", () => {
    document.body.innerHTML =
      '<main data-marimo-lens-scope="article"><article id="outer"><p>Text</p><article id="inner"><em>Detail</em></article></article></main>';
    const outer = visible(document.getElementById("outer")!);
    const inner = visible(document.getElementById("inner")!);
    const detail = visible(document.querySelector("em")!);
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([
      outer,
      inner,
    ]);
    expect(targetFromElement(detail, null)?.element).toBe(inner);
  });

  test("keeps HTML inside SVG visible to fallback scope discovery", () => {
    document.body.innerHTML =
      '<main data-marimo-lens-scope=".group"><svg><g class="group"><foreignObject><div id="html">Text</div></foreignObject></g></svg></main>';
    const target = visible(document.getElementById("html")!);
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([target]);
    expect(targetFromElement(target, null)?.element).toBe(target);
  });

  test("native targets outrank fallback scopes on the same element", () => {
    const output = visible(document.createElement("div"));
    output.id = "output-native";
    output.dataset.marimoLensScope = "section";
    output.append(document.createElement("span"));
    document.body.append(output);
    expect(listTargetSurfaces(document, null).map(({ target }) => target.kind)).toEqual([
      "notebook",
    ]);
  });

  test("scoped HTML groups a tiny clicked child and keeps its bounded evidence", () => {
    document.body.innerHTML =
      '<main data-marimo-lens-scope=".card"><div id="card" class="card"><h2>Forecast</h2><p>Keep <em>this small phrase</em></p></div><button id="loose">Standalone</button></main><p id="outside">Editor chrome</p>';
    const card = visible(document.querySelector<HTMLElement>("#card")!);
    const child = visible(document.querySelector<HTMLElement>("em")!);
    const loose = visible(document.querySelector<HTMLElement>("#loose")!);
    const target = targetFromElement(child, null)!;
    expect(target.element).toBe(card);
    expect(target.target).toMatchObject({ kind: "dom", sources: [], domSelector: "#card" });
    expect(collectDomHint(child, card)).toMatchObject({
      tag: "em",
      text: "this small phrase",
      path: "p > em",
    });
    expect(targetFromElement(loose, null)?.element).toBe(loose);
    expect(targetFromElement(document.querySelector("#outside"), null)).toBeNull();
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([card, loose]);

    document.querySelector("main")!.setAttribute("data-marimo-lens-scope", "p");
    const paragraph = visible(child.parentElement!);
    expect(targetFromElement(child, null)?.element).toBe(paragraph);
  });

  test("explicit parent targets outrank small source hosts and retain their provenance", () => {
    const card = visible(document.createElement("div"));
    card.dataset.marimoLensInputs = "metric-input";
    const value = visible(document.createElement("strong"));
    value.id = "metric-input";
    value.dataset.marimoLensCellId = "producer";
    value.dataset.marimoLensSelector = "metrics.revenue";
    card.append(value);
    document.body.append(card);
    const selected = targetFromElement(value, "strong")!;
    expect(selected.element).toBe(card);
    expect(selected.target).toMatchObject({
      sources: [{ cellId: "producer", selector: "metrics.revenue" }],
    });
    expect(listTargetSurfaces(document, "strong").map(({ element }) => element)).toEqual([card]);
  });

  test("broad scopes preserve native boundaries and reject unresolved source regions", () => {
    document.body.innerHTML =
      '<main data-marimo-lens-scope="section"><div id="output-native"><span>Native</span></div><div data-marimo-lens-inputs="missing"><button>Unresolved</button></div></main>';
    const output = visible(document.querySelector<HTMLElement>("#output-native")!);
    const child = visible(output.querySelector<HTMLElement>("span")!);
    expect(targetFromElement(child, null)?.target).toMatchObject({
      kind: "notebook",
      cellIds: ["native"],
    });
    expect(
      targetFromElement(visible(document.querySelector<HTMLElement>("button")!), null),
    ).toBeNull();
  });

  test("discovers authored regions without configuring or remounting Lens", () => {
    const heading = visible(document.createElement("h1"));
    heading.id = "intro";
    document.body.append(heading);
    expect(targetFromElement(heading, null)).toBeNull();

    heading.dataset.marimoLensTarget = "";
    const selected = targetFromElement(heading, null)!;
    expect(selected.target).toMatchObject({
      kind: "dom",
      domSelector: "#intro",
      sources: [],
      cellIds: [],
    });
    expect(listTargetSurfaces(document, null)).toEqual([selected]);
    expect(getTargetSurface(document, selected.target, null)?.element).toBe(heading);

    delete heading.dataset.marimoLensTarget;
    expect(getTargetSurface(document, selected.target, null)).toBeNull();
    expect(listTargetSurfaces(document, null)).toEqual([]);
    heading.dataset.marimoLensTarget = "";
    expect(getTargetSurface(document, selected.target, null)?.element).toBe(heading);

    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.contentDocument!.body.innerHTML =
      '<h1 id="intro" data-marimo-lens-target>Other view</h1>';
    expect(getTargetSurface(frame.contentDocument!, selected.target, null)).toBeNull();
  });

  test("combines declared regions and instance selectors without duplicate targets", () => {
    const heading = visible(document.createElement("h1"));
    heading.dataset.marimoLensTarget = "";
    const footer = visible(document.createElement("footer"));
    document.body.append(heading, footer);
    expect(listTargetSurfaces(document, "h1, footer").map(({ element }) => element)).toEqual([
      heading,
      footer,
    ]);
    expect(targetFromElement(heading, "footer")?.element).toBe(heading);
    expect(targetFromElement(footer, "footer")?.element).toBe(footer);
  });

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
      return targetFromElement(value, null)!;
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
    const selector = null;
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
      expect(targetFromElement(region, null)).toBeNull();
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

  test("an output-less cell is a notebook target until its output renders", () => {
    document.body.innerHTML =
      '<div id="cell-rates" data-cell-id="rates"><div class="cm-line">discount_rate = 0.07</div></div>';
    const cell = visible(document.getElementById("cell-rates")!);
    const line = cell.querySelector(".cm-line")!;
    const picked = targetFromElement(line, null)!;

    expect(picked.target).toEqual({
      kind: "notebook",
      cellIds: ["rates"],
      documentId: documentIdentity(document),
      documentPath: "/",
    });
    expect(picked.element).toBe(cell);
    expect(listTargetSurfaces(document, null)).toEqual([picked]);
    expect(getTargetSurface(document, picked.target, null)?.element).toBe(cell);

    const output = visible(document.createElement("div"));
    output.id = "output-rates";
    cell.appendChild(output);

    expect(targetFromElement(line, null)).toBeNull();
    expect(getTargetSurface(document, picked.target, null)?.element).toBe(output);
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([output]);
  });

  test("a cell whose output root has no box keeps its code unselectable", () => {
    document.body.innerHTML =
      '<div id="output-slide" style="display:contents"></div><div id="cell-slide" data-cell-id="slide"><div class="cm-line">chart</div></div>';
    const cell = visible(document.getElementById("cell-slide")!);

    expect(targetFromElement(cell.querySelector(".cm-line"), null)).toBeNull();
    expect(listTargetSurfaces(document, null)).toEqual([]);
  });

  test("a cell whose output renders in an open shadow root keeps its code unselectable", () => {
    document.body.innerHTML =
      '<div id="cell-chart" data-cell-id="chart"><div class="cm-line">chart</div><div id="host"></div></div>';
    const cell = visible(document.getElementById("cell-chart")!);
    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    const output = visible(document.createElement("div"));
    output.id = "output-chart";
    shadow.appendChild(output);

    expect(targetFromElement(cell.querySelector(".cm-line"), null)).toBeNull();
    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([output]);
  });

  test("a cell with a configured output root elsewhere lists one surface", () => {
    document.body.innerHTML =
      '<div id="cell-chart" data-cell-id="chart"><div class="cm-line">chart</div></div>' +
      '<section id="custom" data-marimo-lens-output-cell-id="chart">Chart</section>';
    visible(document.getElementById("cell-chart")!);
    const custom = visible(document.getElementById("custom")!);

    expect(listTargetSurfaces(document, null).map(({ element }) => element)).toEqual([custom]);
  });

  test("an output-less cell in an open shadow root is not a target", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<div id="cell-shadow" data-cell-id="shadow"><div class="cm-line">rate = 0.07</div></div>';
    document.body.appendChild(host);
    const cell = visible(shadow.getElementById("cell-shadow")!);

    expect(targetFromElement(cell.querySelector(".cm-line"), null)).toBeNull();
    expect(listTargetSurfaces(document, null)).toEqual([]);
  });

  test("the cell that renders Lens stays unselectable", () => {
    document.body.innerHTML =
      '<div id="cell-lens" data-cell-id="lens"><div class="cm-line">lens</div><div id="output-lens"><span></span></div></div>';
    const cell = visible(document.getElementById("cell-lens")!);
    visible(document.getElementById("output-lens")!);
    const release = registerLensHostOutput(cell.querySelector("span")!);

    expect(targetFromElement(cell.querySelector(".cm-line"), null)).toBeNull();
    expect(listTargetSurfaces(document, null)).toEqual([]);
    release();
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

    const selector = null;
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
    delete section.dataset.marimoLensCellId;
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
