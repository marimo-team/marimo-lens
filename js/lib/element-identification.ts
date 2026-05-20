import { ancestryCrossingShadow, closestCrossingShadow } from "@/lib/shadow-dom";

const HASHED_CLASS_RE = /[A-Z0-9]{6,}/;

export function identifyElement(element: Element): { name: string; path: string } {
  const tag = element.tagName.toLowerCase();
  const aria = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  let name = tag;
  if (aria) name = `${tag} [${aria.slice(0, 48)}]`;
  else if (title) name = `${tag} [${title.slice(0, 48)}]`;
  else if (text && text.length <= 48) name = `${tag} "${text}"`;
  else if (tag === "svg" || closestCrossingShadow(element, "svg")) name = "visual mark";
  else if (tag === "canvas") name = "canvas";
  else if (tag === "th" || element.getAttribute("role") === "columnheader") name = "table column";
  else if (tag === "td" || element.getAttribute("role") === "gridcell") name = "table cell";

  const parts: string[] = [];
  for (const current of ancestryCrossingShadow(element).slice(0, 7).reverse()) {
    const currentTag = current.tagName.toLowerCase();
    if (currentTag === "html" || currentTag === "body") continue;
    const id = current.id ? `#${current.id}` : "";
    const className = stableClassName(current.className);
    parts.push(id || (className ? `${currentTag}.${className}` : currentTag));
  }
  return { name, path: parts.join(" > ") };
}

function stableClassName(className: unknown): string {
  if (typeof className !== "string") return "";
  for (const part of className.split(/\s+/)) {
    if (part.length > 2 && !HASHED_CLASS_RE.test(part)) {
      return part;
    }
  }
  return "";
}
