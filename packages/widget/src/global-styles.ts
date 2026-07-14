const STYLE_ID = "marimo-lens-global-styles";

let owners = 0;
let sharedStyle: HTMLStyleElement | null = null;

export function acquireLensGlobalStyles(css: string): () => void {
  const existing = document.getElementById(STYLE_ID);
  sharedStyle =
    existing instanceof HTMLStyleElement
      ? existing
      : Object.assign(document.createElement("style"), { id: STYLE_ID });
  if (!sharedStyle.isConnected) {
    sharedStyle.setAttribute("data-marimo-lens-ui", "true");
    document.head.appendChild(sharedStyle);
  }
  sharedStyle.textContent = css;
  owners += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    owners = Math.max(0, owners - 1);
    if (owners === 0) {
      sharedStyle?.remove();
      sharedStyle = null;
    }
  };
}
