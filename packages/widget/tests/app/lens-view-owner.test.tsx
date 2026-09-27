import { StrictMode, useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { LensViewOwner } from "@/app/lens-view-owner";
import { getOutputCell } from "@/notebook/output-root";
import { LensPortal } from "@/ui/components/lens-portal";

const roots = new Set<Root>();

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Lens view ownership", () => {
  test("warns on duplicate views, transfers ownership, and releases it after teardown", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = renderView("first");
    const second = renderView("second");
    const third = renderView("third");

    expect(activeViews()).toEqual(["first"]);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("marimo_lens.agent.connect()"));

    await unmountAsync(first);
    expect(activeViews()).toEqual(["second"]);

    await unmountAsync(second);
    expect(activeViews()).toEqual(["third"]);

    await unmountAsync(third);
    renderView("next");
    expect(activeViews()).toEqual(["next"]);
  });

  test("views released in the same teardown never take ownership on the way out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted: string[] = [];
    const first = renderView("first", document, mounted);
    const second = renderView("second", document, mounted);

    // A cleared output tears down all of its Lens views in one task.
    await act(async () => {
      first.unmount();
      second.unmount();
    });
    roots.delete(first);
    roots.delete(second);

    expect(mounted).toEqual(["first"]);
    expect(activeViews()).toEqual([]);
  });

  test("owns views independently in separate documents", () => {
    const secondaryDocument = iframeDocument();
    renderView("primary", document);
    renderView("secondary", secondaryDocument);

    expect(activeViews(document)).toEqual(["primary"]);
    expect(activeViews(secondaryDocument)).toEqual(["secondary"]);
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

function renderView(label: string, ownerDocument = document, mounted: string[] = []): Root {
  const container = ownerDocument.createElement("div");
  ownerDocument.body.appendChild(container);
  const root = createRoot(container);
  roots.add(root);
  act(() =>
    root.render(
      <StrictMode>
        <LensViewOwner>
          <ActiveView label={label} mounted={mounted} />
        </LensViewOwner>
      </StrictMode>,
    ),
  );
  return root;
}

function ActiveView({ label, mounted }: { label: string; mounted: string[] }) {
  useLayoutEffect(() => {
    if (!mounted.includes(label)) mounted.push(label);
  }, [label, mounted]);
  return <span data-active-lens-view>{label}</span>;
}

function unmount(root: Root): void {
  act(() => root.unmount());
  roots.delete(root);
}

async function unmountAsync(root: Root): Promise<void> {
  await act(async () => root.unmount());
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
