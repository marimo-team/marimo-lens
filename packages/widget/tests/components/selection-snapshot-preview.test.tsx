import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { SnapshotAsset } from "@/protocol";

import { SnapshotPreviewButton } from "@/components/selection-snapshot-preview";

import { selectionFixture } from "../test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
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
    await act(async () => trigger.focus());

    expect(loadSnapshot).toHaveBeenCalledWith(selection.id);
    expect(document.querySelector("[data-marimo-lens-snapshot-preview]")).not.toBeNull();
    expect(document.querySelector<HTMLImageElement>(".ml-snapshot-preview__image img")?.src).toBe(
      "blob:marimo-lens-snapshot",
    );
    expect(document.body.textContent).toContain(
      "This is the snapshot an image-capable agent receives.",
    );
    expect(createObjectURL).toHaveBeenCalledOnce();

    act(() => root?.unmount());
    root = null;
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:marimo-lens-snapshot");
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
});

function renderPreview(
  loadSnapshot: React.ComponentProps<typeof SnapshotPreviewButton>["loadSnapshot"],
  selection = selectionFixture(),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <SnapshotPreviewButton selection={selection} capturing={false} loadSnapshot={loadSnapshot} />,
    );
  });
}

function neverSnapshot(): never {
  throw new Error("Fixture snapshot must be stored");
}
