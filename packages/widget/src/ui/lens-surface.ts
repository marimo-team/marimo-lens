import { acquireLensGlobalStyles } from "@/ui/global-styles";

const FRAME_STYLES =
  'html[data-marimo-lens-armed="true"] iframe[data-marimo-lens-pointer-boundary="true"] { pointer-events: none !important; }';

export function createLensSurface(ownerDocument: Document) {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Lens requires a browser window");
  const host = ownerDocument.createElement("div");
  host.setAttribute("data-marimo-lens-portal", "");
  host.setAttribute("data-marimo-lens-ui", "");
  // marimo's PNG export filter skips nodes with this class.
  host.className = "print:hidden";
  const shadow = host.attachShadow({ mode: "open" });
  const releaseStyles = acquireLensGlobalStyles(ownerDocument, FRAME_STYLES);
  return {
    host,
    root: shadow,
    dispose: () => {
      releaseStyles();
      host.remove();
    },
  };
}
