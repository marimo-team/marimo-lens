import {
  boundedUtf16,
  MEDIA_ATTRIBUTE,
  parseRenderSource,
  parseTargetMedia,
  RENDER_SOURCE_ATTRIBUTE,
  SOURCE_INPUTS_ATTRIBUTE,
  TARGET_LABEL_ATTRIBUTE,
  TARGET_DETAIL_ATTRIBUTE,
  type TargetInfo,
  type TransportValue,
} from "@marimo-lens/protocol";

import type { TargetSurface } from "@/notebook/target-surface";

import { outputlessCellFromRoot } from "@/notebook/output-root";
import { referencedSources } from "@/notebook/projection-sources";

function readInfo(element: Element): TargetInfo | null {
  const label = element.getAttribute(TARGET_LABEL_ATTRIBUTE)?.trim();
  if (!label) return null;
  const detail = element.getAttribute(TARGET_DETAIL_ATTRIBUTE)?.trim();
  const info: TargetInfo = { label: boundedUtf16(label, 256) };
  if (detail) info.detail = boundedUtf16(detail, 512);
  return info;
}

/** Labels are presentation only; target identity and notebook authority stay separate. */
export function targetInfo(target: Pick<TargetSurface, "target" | "element">): TargetInfo {
  const info = targetPresentation(target);
  const renderSource = readJson(target.element, RENDER_SOURCE_ATTRIBUTE, parseRenderSource);
  if (renderSource) info.renderSource = renderSource;
  const media = readJson(target.element, MEDIA_ATTRIBUTE, parseTargetMedia);
  if (media) info.media = media;
  return info;
}

function readJson<T>(
  element: Element,
  attribute: string,
  parse: (value: TransportValue) => T,
): T | null {
  const value = element.getAttribute(attribute);
  if (!value || value.length > 4_096) return null;
  try {
    return parse(JSON.parse(value));
  } catch {
    // Malformed descriptive evidence is omitted, and the target stays selectable.
    return null;
  }
}

function targetPresentation(target: Pick<TargetSurface, "target" | "element">): TargetInfo {
  const explicit = readInfo(target.element);
  if (explicit?.detail) return explicit;
  const hosts = target.element.hasAttribute(SOURCE_INPUTS_ATTRIBUTE)
    ? (referencedSources(target.element) ?? [])
    : Array.from(target.element.querySelectorAll(`[${TARGET_LABEL_ATTRIBUTE}]`));
  const labels = new Set<string>();
  const details = new Set<string>();
  for (const host of hosts) {
    const info = readInfo(host);
    if (info) {
      labels.add(info.label);
      if (info.detail) details.add(info.detail);
    }
  }
  if (labels.size) {
    const sourceLabels = boundedUtf16([...labels].join(" · "), 512);
    const info: TargetInfo = { label: explicit?.label ?? boundedUtf16(sourceLabels, 256) };
    if (explicit) info.detail = sourceLabels;
    else if (details.size) info.detail = boundedUtf16([...details].join(" · "), 512);
    return info;
  }
  if (explicit) return explicit;
  const selectors =
    target.target.kind === "dom"
      ? target.target.sources.flatMap((source) => (source.selector ? [source.selector] : []))
      : [];
  const headingSelector = "h1, h2, h3, h4, h5, h6, [role='heading']";
  const heading = target.element.matches(headingSelector)
    ? target.element
    : target.element.querySelector(headingSelector);
  const labelled = target.element.matches("[aria-label]")
    ? target.element
    : target.element.querySelector("[aria-label]");
  // An output-less cell surface is editor chrome, whose labels name controls.
  const descriptive = outputlessCellFromRoot(target.element)
    ? undefined
    : (heading?.textContent ?? labelled?.getAttribute("aria-label"))?.replace(/\s+/g, " ").trim();
  const cells = target.target.cellIds.length
    ? target.target.cellIds
        .map((cellId) => cellName(target.element.ownerDocument, cellId) ?? `Cell ${cellId}`)
        .join(", ")
    : undefined;
  const info: TargetInfo = {
    label: boundedUtf16(
      selectors.join(" · ") || descriptive || cells || target.element.localName,
      256,
    ),
  };
  if (cells && info.label !== cells) info.detail = boundedUtf16(cells, 512);
  return info;
}

/**
 * Name a cell as marimo's editor shows it. marimo stores a top-level function
 * or class cell under its name with a `*` prefix, and calls unnamed cells `_`.
 */
function cellName(ownerDocument: Document, cellId: string): string | null {
  for (const cell of ownerDocument.querySelectorAll<HTMLElement>(
    "[data-cell-id][data-cell-name]",
  )) {
    if (cell.dataset.cellId !== cellId) continue;
    const name = cell.dataset.cellName?.replace(/^\*/, "");
    return name && name !== "_" && name !== "__" ? name : null;
  }
  return null;
}
