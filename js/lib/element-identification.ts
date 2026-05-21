import { ancestryCrossingShadow, closestCrossingShadow } from "@/lib/shadow-dom";

const HASHED_CLASS_RE = /[A-Z0-9]{6,}/;

type ElementNameContext = {
  aria: string | null;
  element: Element;
  tag: string;
  text: string | undefined;
  title: string | null;
};

type ElementNameRule = {
  matches: (context: ElementNameContext) => boolean;
  name: (context: ElementNameContext) => string;
};

const ELEMENT_NAME_RULES: ElementNameRule[] = [
  {
    matches: ({ aria }) => Boolean(aria),
    name: ({ aria, tag }) => `${tag} [${aria?.slice(0, 48)}]`,
  },
  {
    matches: ({ title }) => Boolean(title),
    name: ({ tag, title }) => `${tag} [${title?.slice(0, 48)}]`,
  },
  {
    matches: ({ text }) => Boolean(text && text.length <= 48),
    name: ({ tag, text }) => `${tag} "${text}"`,
  },
  {
    matches: ({ element, tag }) => tag === "svg" || Boolean(closestCrossingShadow(element, "svg")),
    name: () => "visual mark",
  },
  {
    matches: ({ tag }) => tag === "canvas",
    name: () => "canvas",
  },
  {
    matches: ({ element, tag }) => tag === "th" || element.getAttribute("role") === "columnheader",
    name: () => "table column",
  },
  {
    matches: ({ element, tag }) => tag === "td" || element.getAttribute("role") === "gridcell",
    name: () => "table cell",
  },
];

export function identifyElement(element: Element): { name: string; path: string } {
  const tag = element.tagName.toLowerCase();
  const aria = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  const context = { aria, element, tag, text, title };
  const name = ELEMENT_NAME_RULES.find((rule) => rule.matches(context))?.name(context) ?? tag;

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
