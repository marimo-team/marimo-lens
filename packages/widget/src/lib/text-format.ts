export function formatCount(count: number, label: string): string {
  return `${count.toLocaleString()} ${plural(label, count)}`;
}

export function plural(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

export function normalizeText(value: unknown): string {
  const text =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
      ? String(value)
      : "";
  return text.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
