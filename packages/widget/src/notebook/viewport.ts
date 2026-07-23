import { useEffect, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

export function useViewportRevision(active = true): number {
  const dom = useNotebookDom();
  const [revision, setRevision] = useState(0);

  useEffect(
    () => (active ? dom.subscribeLayout(() => setRevision((current) => current + 1)) : undefined),
    [active, dom],
  );

  return revision;
}
