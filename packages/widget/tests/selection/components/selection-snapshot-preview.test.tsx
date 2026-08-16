import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { SnapshotAsset } from "@/anywidget/client";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";
import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

import { selectionFixture } from "../../support/fixtures";

let root: Root | null = null;
let notebookDom: NotebookDomAdapter | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  notebookDom?.dispose();
  notebookDom = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selection snapshot preview", () => {
  test("shows the exact stored image when the trigger receives focus", async () => {
    const selection = selectionFixture();
    const asset: SnapshotAsset = {
      snapshot: selection.snapshot.status === "available" ? selection.snapshot : neverSnapshot(),
      bytes: new Uint8Array([137, 80, 78, 71]),
    };
    const loadSnapshot = vi.fn(async () => asset);
    const createObjectURL = vi.fn(() => "blob:marimo-lens-snapshot");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    renderPreview(loadSnapshot);
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")!;
    trigger.getBoundingClientRect = () => new DOMRect(900, 500, 40, 20);
    await act(async () => trigger.focus());

    expect(loadSnapshot).toHaveBeenCalledWith(selection.id);
    const preview = document.querySelector<HTMLElement>("[data-marimo-lens-snapshot-preview]")!;
    expect(preview.dataset.placement).toBe("above");
    expect(preview.style.left).toBe("676px");
    expect(preview.style.bottom).toBe("276px");
    expect(document.querySelector<HTMLImageElement>(".ml-snapshot-preview__image img")?.src).toBe(
      "blob:marimo-lens-snapshot",
    );
    expect(document.body.textContent).toContain(
      "This annotated image is available to vision-capable agents.",
    );
    expect(createObjectURL).toHaveBeenCalledOnce();

    act(() => root?.unmount());
    root = null;
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:marimo-lens-snapshot");
  });

  test("creates and releases snapshot URLs through the preview document", async () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const ownerDocument = frame.contentDocument;
    const ownerWindow = frame.contentWindow;
    if (!ownerDocument || !ownerWindow) throw new Error("Iframe document must be available");
    const ownerGlobal = ownerWindow.self;
    const selection = selectionFixture();
    const asset: SnapshotAsset = {
      snapshot: selection.snapshot.status === "available" ? selection.snapshot : neverSnapshot(),
      bytes: new Uint8Array([137, 80, 78, 71]),
    };
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

    renderPreviews(new SelectionSnapshotLoader(async () => asset), selection, 1, ownerDocument);
    const trigger = ownerDocument.querySelector<HTMLButtonElement>(
      "button[aria-haspopup='dialog']",
    )!;
    await act(async () => trigger.focus());

    expect(createBlob).toHaveBeenCalledOnce();
    expect(secondaryCreate).toHaveBeenCalledOnce();
    expect(primaryCreate).not.toHaveBeenCalled();
    expect(
      ownerDocument.querySelector<HTMLImageElement>(".ml-snapshot-preview__image img")?.src,
    ).toBe("blob:secondary-snapshot");

    act(() => root?.unmount());
    root = null;
    expect(secondaryRevoke).toHaveBeenCalledWith("blob:secondary-snapshot");
  });

  test("labels a retained image as outdated", async () => {
    const available = selectionFixture().snapshot;
    if (available.status !== "available") throw new Error("Fixture snapshot must be available");
    const selection = selectionFixture({ snapshot: { ...available, status: "outdated" } });
    const loadSnapshot = vi.fn(async () => ({
      snapshot: selection.snapshot.status === "outdated" ? selection.snapshot : neverSnapshot(),
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
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
    const loadSnapshot = vi.fn(async () => ({
      snapshot: selection.snapshot.status === "available" ? selection.snapshot : neverSnapshot(),
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
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
    renderPreview(async () => ({
      snapshot: selection.snapshot.status === "available" ? selection.snapshot : neverSnapshot(),
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
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
      new SelectionSnapshotLoader(async () => {
        throw new Error("Snapshot loading is not expected");
      }),
      selectionFixture({ snapshot: { status: "pending" } }),
      2,
    );

    const iconStatus = document.querySelector<HTMLElement>(
      ".ml-snapshot-trigger--icon[data-status='capturing']",
    );
    expect(iconStatus?.tagName).toBe("OUTPUT");
    expect(iconStatus?.getAttribute("aria-label")).toBe("Preparing image");
  });

  test("shares snapshot bytes across marker and sheet previews, then reloads after close", async () => {
    const selection = selectionFixture();
    const snapshot = selection.snapshot;
    if (snapshot.status !== "available") throw new Error("Fixture snapshot must be available");
    const asset: SnapshotAsset = {
      snapshot,
      bytes: new Uint8Array([137, 80, 78, 71]),
    };
    const first = deferred<SnapshotAsset>();
    const second = deferred<SnapshotAsset>();
    const loadSnapshot = vi
      .fn<(selectionId: string) => Promise<SnapshotAsset>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const snapshotLoader = new SelectionSnapshotLoader(loadSnapshot);
    const createObjectURL = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValueOnce("blob:preview-1")
      .mockReturnValueOnce("blob:preview-2")
      .mockReturnValueOnce("blob:preview-3")
      .mockReturnValueOnce("blob:preview-4");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    renderPreviews(snapshotLoader, selection, 3);
    const triggers = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[aria-haspopup='dialog']"),
    );
    await act(async () => {
      triggers[0]?.click();
      triggers[1]?.click();
      await Promise.resolve();
    });

    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadSnapshot).toHaveBeenCalledWith(selection.id);

    await act(async () => {
      first.resolve(asset);
      await first.promise;
    });

    expect(document.querySelectorAll(".ml-snapshot-preview__image img")).toHaveLength(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    await act(async () => triggers[2]?.click());
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".ml-snapshot-preview__image img")).toHaveLength(3);
    expect(createObjectURL).toHaveBeenCalledTimes(3);

    const closeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[aria-label="Close preview"]'),
    );
    act(() => {
      for (const button of closeButtons) button.click();
    });

    expect(revokeObjectURL).toHaveBeenCalledTimes(3);

    await act(async () => {
      triggers[0]?.click();
      await Promise.resolve();
    });
    expect(loadSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(asset);
      await second.promise;
    });
    expect(document.querySelector<HTMLImageElement>(".ml-snapshot-preview__image img")?.src).toBe(
      "blob:preview-4",
    );
  });
});

function renderPreview(
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>,
  selection = selectionFixture(),
) {
  renderPreviews(new SelectionSnapshotLoader(loadSnapshot), selection, 1);
}

function renderPreviews(
  snapshotLoader: SelectionSnapshotLoader,
  selection: ReturnType<typeof selectionFixture>,
  count: number,
  ownerDocument = document,
) {
  const container = ownerDocument.createElement("div");
  ownerDocument.body.appendChild(container);
  const adapter = new NotebookDomAdapter(ownerDocument);
  notebookDom = adapter;
  root = createRoot(container);
  act(() => {
    root?.render(
      <NotebookDomProvider adapter={adapter}>
        {Array.from({ length: count }, (_, index) => (
          <SnapshotPreviewButton
            key={index}
            selection={selection}
            capturing={false}
            variant={index % 2 === 0 ? "label" : "icon"}
            snapshotLoader={snapshotLoader}
          />
        ))}
      </NotebookDomProvider>,
    );
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function neverSnapshot(): never {
  throw new Error("Fixture snapshot must be stored");
}
