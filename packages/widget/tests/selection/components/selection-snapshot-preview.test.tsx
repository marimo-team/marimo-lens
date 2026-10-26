import type { Selection } from "@marimo-lens/protocol";

import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { SnapshotAsset } from "@/anywidget/client";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";
import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";

import { deferred, selectionFixture } from "../../support/fixtures";
import { render } from "../../support/render";

let notebookDom: NotebookDomAdapter | null = null;

afterEach(() => {
  notebookDom?.dispose();
  notebookDom = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selection snapshot preview", () => {
  test("loads the selection's stored image when the trigger receives focus", async () => {
    const selection = selectionFixture();
    const loadSnapshot = vi.fn(async () => storedAsset(selection));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:marimo-lens-snapshot",
      revokeObjectURL: () => {},
    });

    renderPreview(loadSnapshot, selection);
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    await act(async () => trigger.focus());

    expect(loadSnapshot).toHaveBeenCalledWith(selection.id);
    expect(document.querySelector<HTMLImageElement>("[data-marimo-lens-snapshot-image]")?.src).toBe(
      "blob:marimo-lens-snapshot",
    );
  });

  test("creates and releases snapshot URLs through the preview document", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow;
    if (!ownerDocument || !ownerWindow) throw new Error("Iframe document must be available");
    const ownerGlobal = ownerWindow.self;
    const selection = selectionFixture();
    const asset = storedAsset(selection);
    const primaryCreate = vi.fn(() => "blob:primary-snapshot");
    vi.stubGlobal("URL", { ...URL, createObjectURL: primaryCreate, revokeObjectURL: vi.fn() });
    const secondaryCreate = vi.fn(() => "blob:secondary-snapshot");
    const secondaryRevoke = vi.fn();
    Object.defineProperty(ownerGlobal, "URL", {
      configurable: true,
      value: { createObjectURL: secondaryCreate, revokeObjectURL: secondaryRevoke },
    });
    const OwnerBlob = ownerGlobal.Blob;
    const createBlob = vi.fn();
    Object.defineProperty(ownerGlobal, "Blob", {
      configurable: true,
      value: class extends OwnerBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          createBlob(parts, options);
        }
      },
    });

    const view = renderPreviews(async () => asset, selection, 1, ownerDocument);
    const trigger = ownerDocument.querySelector<HTMLButtonElement>(
      "button[aria-haspopup='dialog']",
    )!;
    await act(async () => trigger.focus());

    expect(createBlob).toHaveBeenCalledOnce();
    expect(secondaryCreate).toHaveBeenCalledOnce();
    expect(primaryCreate).not.toHaveBeenCalled();
    expect(
      ownerDocument.querySelector<HTMLImageElement>("[data-marimo-lens-snapshot-image]")?.src,
    ).toBe("blob:secondary-snapshot");

    view.unmount();
    expect(secondaryRevoke).toHaveBeenCalledWith("blob:secondary-snapshot");
  });

  test("labels a retained image as outdated", async () => {
    const available = selectionFixture().snapshot;
    if (available.status !== "available") throw new Error("Fixture snapshot must be available");
    const selection = selectionFixture({ snapshot: { ...available, status: "outdated" } });
    const loadSnapshot = vi.fn(async () => storedAsset(selection));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:outdated-snapshot",
      revokeObjectURL: () => {},
    });

    renderPreview(loadSnapshot, selection);
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    await act(async () => trigger.focus());

    expect(document.body.textContent).toContain("Captured before this selection moved.");
  });

  test("restores the snapshot trigger after closing the preview", async () => {
    const selection = selectionFixture();
    const loadSnapshot = vi.fn(async () => storedAsset(selection));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:focus-snapshot",
      revokeObjectURL: () => {},
    });
    renderPreview(loadSnapshot, selection);
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    await act(async () => trigger.focus());
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!;

    act(() => {
      close.focus();
      close.click();
    });

    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector("[data-marimo-lens-snapshot-preview]")).toBeNull();
  });

  test("moves keyboard focus into a pinned preview and closes when focus leaves", async () => {
    const selection = selectionFixture();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:keyboard-snapshot",
      revokeObjectURL: () => {},
    });
    renderPreview(async () => storedAsset(selection));
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    await act(async () => {
      trigger.focus();
      trigger.click();
      await Promise.resolve();
    });

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close preview");
    act(() => outside.focus());
    expect(document.querySelector("[data-marimo-lens-snapshot-preview]")).toBeNull();
  });

  test("announces pending icon-only image state", () => {
    renderPreviews(
      async () => {
        throw new Error("Snapshot loading is not expected");
      },
      selectionFixture({ snapshot: { status: "pending" } }),
      2,
    );

    const iconStatus = document.querySelector<HTMLElement>(
      "[data-marimo-lens-snapshot-trigger][data-status='capturing']",
    );
    expect(iconStatus?.tagName).toBe("OUTPUT");
    expect(iconStatus?.getAttribute("aria-label")).toBe("Preparing image");
  });

  test("releases the image on close and reloads it when the preview opens again", async () => {
    const selection = selectionFixture();
    const asset = storedAsset(selection);
    const first = deferred<SnapshotAsset>();
    const second = deferred<SnapshotAsset>();
    const loadSnapshot = vi
      .fn<(selectionId: string) => Promise<SnapshotAsset>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const createObjectURL = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValueOnce("blob:preview-1")
      .mockReturnValueOnce("blob:preview-2");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    renderPreview(loadSnapshot, selection);
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    await act(async () => trigger.click());
    expect(loadSnapshot).toHaveBeenCalledWith(selection.id);

    await act(async () => {
      first.resolve(asset);
      await first.promise;
    });
    expect(document.querySelector<HTMLImageElement>("[data-marimo-lens-snapshot-image]")?.src).toBe(
      "blob:preview-1",
    );

    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')?.click());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");

    await act(async () => trigger.click());
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(asset);
      await second.promise;
    });
    expect(document.querySelector<HTMLImageElement>("[data-marimo-lens-snapshot-image]")?.src).toBe(
      "blob:preview-2",
    );
  });
});

function renderPreview(
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>,
  selection = selectionFixture(),
) {
  renderPreviews(loadSnapshot, selection, 1);
}

function renderPreviews(
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>,
  selection: ReturnType<typeof selectionFixture>,
  count: number,
  ownerDocument = document,
) {
  const adapter = new NotebookDomAdapter(ownerDocument);
  notebookDom = adapter;
  return render(
    <NotebookDomProvider adapter={adapter}>
      {Array.from({ length: count }, (_, index) => (
        <SnapshotPreviewButton key={index} selection={selection} loadSnapshot={loadSnapshot} />
      ))}
    </NotebookDomProvider>,
    ownerDocument,
  );
}

function storedAsset(selection: Selection): SnapshotAsset {
  const { snapshot } = selection;
  if (snapshot.status !== "available" && snapshot.status !== "outdated") {
    throw new Error("Fixture snapshot must be stored");
  }
  return { snapshot, bytes: new Uint8Array([137, 80, 78, 71]) };
}
