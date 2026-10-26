import type { TargetSelector } from "@marimo-lens/protocol";

import { useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";

import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { NotebookDomProvider } from "@/notebook/notebook-dom-context";

/** Provide an adapter. A `selector` is set while rendering, as the Lens controller sets it. */
export function NotebookDomTestProvider({
  children,
  ownerDocument = document,
  selector,
}: {
  children: ReactNode;
  ownerDocument?: Document;
  selector?: TargetSelector;
}) {
  const adapter = useMemo(() => new NotebookDomAdapter(ownerDocument), [ownerDocument]);
  if (selector !== undefined) adapter.setSelector(selector);
  useLayoutEffect(() => adapter.publishSelector(), [adapter, selector]);
  useEffect(() => () => adapter.dispose(), [adapter]);
  return <NotebookDomProvider adapter={adapter}>{children}</NotebookDomProvider>;
}
