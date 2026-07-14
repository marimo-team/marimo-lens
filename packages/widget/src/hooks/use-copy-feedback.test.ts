import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { RefreshState } from "@/types";

import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { LensUiStoreProvider, useLensUiStore } from "@/store";

type CopyProps = {
  contextRevision: number;
  feedbackText: string;
  onScan: (requestId?: string) => void;
  refreshState: RefreshState;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useCopyFeedback", () => {
  test("copies after a successful refresh even when rendered text is unchanged", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    let requestId = "";
    let updateProps: (patch: Partial<CopyProps>) => void = () => {};
    const initialProps: CopyProps = {
      contextRevision: 1,
      feedbackText: "compact prompt without changing timestamp",
      onScan: (id) => {
        requestId = id ?? "";
      },
      refreshState: {},
    };

    ({ root, container } = renderCopyHarness(initialProps, (update) => {
      updateProps = update;
    }));

    await act(async () => {
      copyButton().click();
    });

    expect(requestId).toMatch(/^copy-/);
    expect(copyButton().dataset.status).toBe("pending");

    await act(async () => {
      updateProps({
        contextRevision: 2,
        feedbackText: "compact prompt without changing timestamp",
        refreshState: {
          contextRevision: 2,
          pairPromptRevision: 2,
          requestId,
          status: "success",
        },
      });
    });

    expect(writeText).toHaveBeenCalledWith("compact prompt without changing timestamp");
    expect(copyButton().dataset.status).toBe("success");
  });
});

function renderCopyHarness(
  initialProps: CopyProps,
  onReady: (update: (patch: Partial<CopyProps>) => void) => void,
): { root: Root; container: HTMLDivElement } {
  const target = document.createElement("div");
  document.body.append(target);
  const nextRoot = createRoot(target);

  act(() => {
    nextRoot.render(createElement(CopyHarnessController, { initialProps, onReady }));
  });

  return { root: nextRoot, container: target };
}

function CopyHarnessController({
  initialProps,
  onReady,
}: {
  initialProps: CopyProps;
  onReady: (update: (patch: Partial<CopyProps>) => void) => void;
}) {
  const [props, setProps] = useState(initialProps);

  useEffect(() => {
    onReady((patch) => setProps((current) => ({ ...current, ...patch })));
  }, [onReady]);

  return createElement(LensUiStoreProvider, null, createElement(CopyHarness, props));
}

function CopyHarness(props: CopyProps) {
  const copy = useCopyFeedback(props);
  const copyStatus = useLensUiStore((state) => state.copyStatus);
  return createElement(
    "button",
    { "data-status": copyStatus, onClick: copy, type: "button" },
    "copy",
  );
}

function copyButton(): HTMLButtonElement {
  const button = container?.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("copy test harness did not render a button");
  }
  return button;
}
