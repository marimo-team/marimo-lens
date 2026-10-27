import { useLayoutEffect, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

export function useViewportRevision(active = true): number {
  const dom = useNotebookDom();
  const [revision, setRevision] = useState(0);

  // Subscribe before paint so layout changes after commit reach the next render.
  useLayoutEffect(
    () => (active ? dom.subscribeLayout(() => setRevision((current) => current + 1)) : undefined),
    [active, dom],
  );

  return revision;
}
