/** Declarative metadata that any client can publish on its rendered elements. */
export const TARGET_LABEL_ATTRIBUTE = "data-marimo-lens-label";
export const TARGET_DETAIL_ATTRIBUTE = "data-marimo-lens-detail";
export const SOURCE_CELL_ATTRIBUTE = "data-marimo-lens-cell-id";
export const SOURCE_SELECTOR_ATTRIBUTE = "data-marimo-lens-selector";
export const SOURCE_INPUTS_ATTRIBUTE = "data-marimo-lens-inputs";
export const RENDER_SOURCE_ATTRIBUTE = "data-marimo-lens-render-source";
export const CAPTURE_CONTEXT_ATTRIBUTE = "data-marimo-lens-context";

export const TARGET_METADATA_ATTRIBUTES = [
  TARGET_LABEL_ATTRIBUTE,
  TARGET_DETAIL_ATTRIBUTE,
  SOURCE_CELL_ATTRIBUTE,
  SOURCE_SELECTOR_ATTRIBUTE,
  SOURCE_INPUTS_ATTRIBUTE,
  RENDER_SOURCE_ATTRIBUTE,
  CAPTURE_CONTEXT_ATTRIBUTE,
] as const;
