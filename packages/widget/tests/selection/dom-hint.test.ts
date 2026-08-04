import { describe, expect, test } from "vite-plus/test";

import { collectDomHint } from "@/selection/dom-hint";

describe("generic DOM hints", () => {
  test("collects bounded accessible evidence with a generic path", () => {
    const output = document.createElement("div");
    const wrapper = document.createElement("section");
    const button = document.createElement("button");
    button.className = "library-private generated-9281";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", "Toggle forecast");
    button.textContent = `Forecast ${"detail ".repeat(80)}`;
    wrapper.appendChild(button);
    output.appendChild(wrapper);
    Object.defineProperties(output, {
      scrollWidth: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 200 },
    });
    output.getBoundingClientRect = () => new DOMRect(10, 20, 400, 200);
    button.getBoundingClientRect = () => new DOMRect(110, 70, 100, 40);

    const hint = collectDomHint(button, output);

    expect(hint).toMatchObject({
      tag: "button",
      role: "switch",
      ariaLabel: "Toggle forecast",
      path: "section > button",
      bounds: { x: 0.25, y: 0.25, width: 0.25, height: 0.2 },
    });
  });

  test("records open shadow boundaries generically", () => {
    const output = document.createElement("div");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const mark = document.createElement("svg");
    shadow.appendChild(mark);
    output.appendChild(host);
    output.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    mark.getBoundingClientRect = () => new DOMRect(10, 10, 50, 50);

    expect(collectDomHint(mark, output).path).toContain("::shadow");
  });

  test("collects readable labels from styled output", () => {
    const output = document.createElement("div");
    const legend = document.createElement("div");
    legend.className = "plot-swatches";
    legend.innerHTML = [
      "<style>:where(.plot-swatches) { display: flex; }</style>",
      "<span>Public</span> ",
      "<span>Private</span>",
    ].join("");
    output.appendChild(legend);
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    legend.getBoundingClientRect = () => new DOMRect(0, 0, 200, 40);

    expect(collectDomHint(legend, output).text).toBe("Public Private");
  });

  test("does not split emoji at UTF-16 evidence limits", () => {
    const output = document.createElement("div");
    const button = document.createElement("button");
    button.setAttribute("aria-label", `${"a".repeat(159)}😀`);
    button.textContent = `${"b".repeat(239)}😀`;
    output.appendChild(button);
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    button.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);

    const hint = collectDomHint(button, output);

    expect(hint.ariaLabel).toBe("a".repeat(159));
    expect(hint.text).toBe("b".repeat(239));
  });
});
