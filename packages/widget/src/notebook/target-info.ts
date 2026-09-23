import {
  boundedUtf16,
  parseRenderSource,
  RENDER_SOURCE_ATTRIBUTE,
  SOURCE_INPUTS_ATTRIBUTE,
  TARGET_LABEL_ATTRIBUTE,
  TARGET_DETAIL_ATTRIBUTE,
  type TargetInfo,
} from "@marimo-lens/protocol";

import type { TargetSurface } from "@/notebook/selection-target";

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
export function targetInfo(target: TargetSurface): TargetInfo {
  const info = targetPresentation(target);
  const value = target.element.getAttribute(RENDER_SOURCE_ATTRIBUTE);
  if (value && value.length <= 4_096) {
    try {
      info.renderSource = parseRenderSource(JSON.parse(value));
    } catch {
      // Malformed descriptive evidence cannot establish an editable source location.
    }
  }
  return info;
}

function targetPresentation(target: TargetSurface): TargetInfo {
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
    ? `Cell ${target.target.cellIds.join(", ")}`
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
