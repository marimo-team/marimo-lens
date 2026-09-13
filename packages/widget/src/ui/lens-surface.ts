import { acquireLensGlobalStyles } from "@/ui/global-styles";

const DARK_THEME =
  '.dark, .dark-mode, [data-theme="dark"], [data-mode="dark"], [data-vscode-theme-kind="vscode-dark"], [data-vscode-theme-kind="vscode-high-contrast"]';
const FRAME_STYLES =
  'html[data-marimo-lens-armed="true"] iframe[data-marimo-lens-pointer-boundary="true"] { pointer-events: none !important; }';

export function createLensSurface(ownerDocument: Document) {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Lens requires a browser window");
  const host = ownerDocument.createElement("div");
  host.setAttribute("data-marimo-lens-portal", "");
  host.setAttribute("data-marimo-lens-ui", "");
  const shadow = host.attachShadow({ mode: "open" });
  ownerDocument.body.append(host);
  const updateTheme = () => {
    host.dataset.theme = [ownerDocument.documentElement, ownerDocument.body].some((element) =>
      element.matches(DARK_THEME),
    )
      ? "dark"
      : "light";
  };
  updateTheme();
  const observer = new ownerWindow.MutationObserver(updateTheme);
  for (const element of [ownerDocument.documentElement, ownerDocument.body]) {
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-mode", "data-vscode-theme-kind"],
    });
  }
  const releaseStyles = acquireLensGlobalStyles(ownerDocument, FRAME_STYLES);
  return {
    root: shadow,
    dispose: () => {
      observer.disconnect();
      releaseStyles();
      host.remove();
    },
  };
}
