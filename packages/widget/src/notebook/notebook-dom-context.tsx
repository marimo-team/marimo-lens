import { createContext, useContext, type ReactNode } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

const NotebookDomContext = createContext<NotebookDomAdapter | null>(null);

export function NotebookDomProvider({
  adapter,
  children,
}: {
  adapter: NotebookDomAdapter;
  children: ReactNode;
}) {
  return <NotebookDomContext value={adapter}>{children}</NotebookDomContext>;
}

export function useNotebookDom(): NotebookDomAdapter {
  const adapter = useContext(NotebookDomContext);
  if (!adapter) throw new Error("Lens notebook DOM is unavailable");
  return adapter;
}
