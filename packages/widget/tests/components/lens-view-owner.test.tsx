import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { getOutputCell } from "@/capture/output-root";
import { LensViewOwner } from "@/components/lens-view-owner";

const roots = new Set<Root>();

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
});

describe("Lens view ownership", () => {
  test("keeps one active view per model and promotes its standby", () => {
    const model = {};
    const first = renderView("first", model);
    renderView("second", model);

    expect(activeViews()).toEqual(["first"]);
    expect(document.querySelectorAll("[data-marimo-lens-host]")).toHaveLength(2);
    expect(document.querySelector("[data-marimo-lens-model-conflict]")).toBeNull();

    act(() => first.unmount());
    roots.delete(first);

    expect(activeViews()).toEqual(["second"]);
    expect(document.querySelectorAll("[data-marimo-lens-host]")).toHaveLength(1);
  });

  test("surfaces a distinct model conflict and promotes it when the owner leaves", () => {
    const first = renderView("first", {});
    renderView("second", {});

    expect(activeViews()).toEqual(["first"]);
    const conflict = document.querySelector("output[data-marimo-lens-model-conflict]");
    expect(conflict?.textContent).toBe(
      "Lens is already activeUse the existing Lens instance in this notebook.",
    );

    act(() => first.unmount());
    roots.delete(first);

    expect(activeViews()).toEqual(["second"]);
    expect(document.querySelector("[data-marimo-lens-model-conflict]")).toBeNull();
  });

  test("keeps a same-model standby ahead of a conflicting model", () => {
    const model = {};
    const first = renderView("first", model);
    const standby = renderView("standby", model);
    renderView("conflict", {});

    expect(activeViews()).toEqual(["first"]);
    expect(document.querySelector("output[data-marimo-lens-model-conflict]")).not.toBeNull();

    act(() => first.unmount());
    roots.delete(first);
    expect(activeViews()).toEqual(["standby"]);
    expect(document.querySelector("output[data-marimo-lens-model-conflict]")).not.toBeNull();

    act(() => standby.unmount());
    roots.delete(standby);
    expect(activeViews()).toEqual(["conflict"]);
    expect(document.querySelector("[data-marimo-lens-model-conflict]")).toBeNull();
  });

  test("owns views independently in separate documents", () => {
    const secondaryDocument = document.implementation.createHTMLDocument("secondary");
    renderView("primary", {}, document);
    renderView("secondary", {}, secondaryDocument);

    expect(activeViews(document)).toEqual(["primary"]);
    expect(activeViews(secondaryDocument)).toEqual(["secondary"]);
    expect(document.querySelector("[data-marimo-lens-model-conflict]")).toBeNull();
    expect(secondaryDocument.querySelector("[data-marimo-lens-model-conflict]")).toBeNull();
  });

  test("registers its owning output across an open shadow root", () => {
    const output = document.createElement("div");
    output.id = "output-lens-cell";
    output.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    const widget = document.createElement("marimo-anywidget");
    const shadow = widget.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.appendChild(container);
    output.appendChild(widget);
    document.body.appendChild(output);
    const root = createRoot(container);
    roots.add(root);

    act(() =>
      root.render(
        <LensViewOwner model={{}}>
          <span>Lens</span>
        </LensViewOwner>,
      ),
    );

    expect(getOutputCell("lens-cell")).toBeNull();

    act(() => root.unmount());
    roots.delete(root);
    expect(getOutputCell("lens-cell")).toMatchObject({ id: "lens-cell", element: output });
  });
});

function renderView(label: string, model: object, ownerDocument = document): Root {
  const container = ownerDocument.createElement("div");
  ownerDocument.body.appendChild(container);
  const root = createRoot(container);
  roots.add(root);
  act(() =>
    root.render(
      <StrictMode>
        <LensViewOwner model={model}>
          <span data-active-lens-view>{label}</span>
        </LensViewOwner>
      </StrictMode>,
    ),
  );
  return root;
}

function activeViews(ownerDocument = document): string[] {
  return [...ownerDocument.querySelectorAll("[data-active-lens-view]")].map(
    (element) => element.textContent ?? "",
  );
}
