import { useEffect, useMemo, type ReactNode } from "react";

import { NotebookDomAdapter, NotebookDomProvider } from "@/notebook/notebook-dom";

export function NotebookDomTestProvider({
  children,
  ownerDocument = document,
}: {
  children: ReactNode;
  ownerDocument?: Document;
}) {
  const adapter = useMemo(() => new NotebookDomAdapter(ownerDocument), [ownerDocument]);
  useEffect(() => () => adapter.dispose(), [adapter]);
  return <NotebookDomProvider adapter={adapter}>{children}</NotebookDomProvider>;
}
