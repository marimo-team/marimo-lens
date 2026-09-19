import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { LensViewOwner } from "@/app/lens-view-owner";
import { getOutputCell } from "@/notebook/output-root";
import { LensPortal } from "@/ui/components/lens-portal";

const roots = new Set<Root>();

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
});

describe("Lens view ownership", () => {
  test("reports conflicts, transfers ownership, and releases it after teardown", () => {
    const first = renderView("first");
    const second = renderView("second");
    const third = renderView("third");

    expect(activeViews()).toEqual(["first"]);
    expect(document.querySelectorAll("[data-marimo-lens-view-conflict]")).toHaveLength(2);
    const message = document.querySelector("[data-marimo-lens-view-conflict]")?.textContent;
    expect(message).toContain("Lens is already active");
    expect(message).toContain("Use the existing Lens instance in this notebook.");

    unmount(first);
    expect(activeViews()).toEqual(["second"]);
    expect(document.querySelectorAll("[data-marimo-lens-view-conflict]")).toHaveLength(1);

    unmount(second);
    expect(activeViews()).toEqual(["third"]);
    expect(document.querySelector("[data-marimo-lens-view-conflict]")).toBeNull();

    unmount(third);
    renderView("next");
    expect(activeViews()).toEqual(["next"]);
    expect(document.querySelector("[data-marimo-lens-view-conflict]")).toBeNull();
  });

  test("owns views independently in separate documents", () => {
    const secondaryDocument = iframeDocument();
    renderView("primary", document);
    renderView("secondary", secondaryDocument);

    expect(activeViews(document)).toEqual(["primary"]);
    expect(activeViews(secondaryDocument)).toEqual(["secondary"]);
    expect(document.querySelector("[data-marimo-lens-view-conflict]")).toBeNull();
    expect(secondaryDocument.querySelector("[data-marimo-lens-view-conflict]")).toBeNull();
  });

  test("owns the portal surface and stylesheet through host-document teardown", () => {
    const secondaryDocument = iframeDocument();
    const container = secondaryDocument.createElement("div");
    secondaryDocument.body.appendChild(container);
    const root = createRoot(container);
    roots.add(root);

    act(() =>
      root.render(
        <LensViewOwner>
          <LensPortal css=".marimo_lens { color: blue; }">
            <span data-secondary-lens>Lens</span>
          </LensPortal>
        </LensViewOwner>,
      ),
    );

    expect(document.querySelector("[data-secondary-lens]")).toBeNull();
    const shadow = secondaryDocument.querySelector("[data-marimo-lens-portal]")!.shadowRoot!;
    expect(shadow.querySelector("[data-secondary-lens]")?.textContent).toBe("Lens");
    expect(shadow.ownerDocument).toBe(secondaryDocument);
    expect(shadow.querySelector("style")?.textContent).toBe(".marimo_lens { color: blue; }");
    expect(shadow.querySelector(".marimo_lens")).toBe(
      shadow.querySelector("[data-marimo-lens-root]"),
    );

    unmount(root);
    expect(shadow.host.isConnected).toBe(false);
    expect(secondaryDocument.getElementById("marimo-lens-global-styles")).toBeNull();
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
        <LensViewOwner>
          <span>Lens</span>
        </LensViewOwner>,
      ),
    );

    expect(getOutputCell(document, "lens-cell")).toBeNull();

    act(() => root.unmount());
    roots.delete(root);
    expect(getOutputCell(document, "lens-cell")).toMatchObject({
      id: "lens-cell",
      element: output,
    });
  });
});

function renderView(label: string, ownerDocument = document): Root {
  const container = ownerDocument.createElement("div");
  ownerDocument.body.appendChild(container);
  const root = createRoot(container);
  roots.add(root);
  act(() =>
    root.render(
      <StrictMode>
        <LensViewOwner>
          <span data-active-lens-view>{label}</span>
        </LensViewOwner>
      </StrictMode>,
    ),
  );
  return root;
}

function unmount(root: Root): void {
  act(() => root.unmount());
  roots.delete(root);
}

function activeViews(ownerDocument = document): string[] {
  return [...ownerDocument.querySelectorAll("[data-active-lens-view]")].map(
    (element) => element.textContent ?? "",
  );
}

function iframeDocument(): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  return frame.contentDocument!;
}
