import { useEffect, useEffectEvent, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

export type ObjectUrl = { url: string } | { error: unknown };

/**
 * Load PNG bytes while `key` is set and show them through an object URL of
 * the Lens document's window. Clearing or changing `key` revokes the URL, so
 * showing the same key again loads it again. Null means nothing has loaded yet.
 */
export function useObjectUrl(
  key: string | null,
  load: () => Promise<Uint8Array<ArrayBuffer>>,
): ObjectUrl | null {
  const dom = useNotebookDom();
  const [loaded, setLoaded] = useState<(ObjectUrl & { key: string }) | null>(null);
  const read = useEffectEvent(load);

  useEffect(() => {
    if (key === null) return undefined;
    const ownerWindow = dom.window;
    let active = true;
    let url: string | null = null;
    void read().then(
      (bytes) => {
        if (!active) return;
        url = ownerWindow.URL.createObjectURL(new ownerWindow.Blob([bytes], { type: "image/png" }));
        setLoaded({ key, url });
      },
      (cause: unknown) => {
        if (active) setLoaded({ key, error: cause });
      },
    );
    return () => {
      active = false;
      if (url) ownerWindow.URL.revokeObjectURL(url);
      setLoaded((current) => (current?.key === key ? null : current));
    };
  }, [dom, key]);

  return loaded?.key === key ? loaded : null;
}
