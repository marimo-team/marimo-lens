import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const mounted = new Set<Root>();

/** Render `node` into a new container in `ownerDocument`. The test setup unmounts it after each test. */
export function render(node: ReactNode, ownerDocument: Document = document) {
  const container = ownerDocument.body.appendChild(ownerDocument.createElement("div"));
  const root = createRoot(container);
  mounted.add(root);
  act(() => root.render(node));
  return {
    root,
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => {
      mounted.delete(root);
      act(() => root.unmount());
    },
  };
}

export function unmountAll(): void {
  for (const root of mounted) act(() => root.unmount());
  mounted.clear();
}
