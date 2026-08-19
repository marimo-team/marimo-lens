import type { TargetSelector } from "@marimo-lens/protocol";

import { useEffect, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

export function useViewportRevision(active = true, selector?: TargetSelector): number {
  const dom = useNotebookDom();
  const [revision, setRevision] = useState(0);

  useEffect(
    () =>
      active
        ? dom.subscribeLayout(() => setRevision((current) => current + 1), selector)
        : undefined,
    [active, dom, selector],
  );

  return revision;
}
