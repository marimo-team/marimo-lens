const CHART_LIBRARY_ALIASES: Record<string, readonly string[]> = {
  altair: ["vega"],
  "marimo-data-explorer": ["vega"],
  vega: ["altair"],
};

export function compatibleChartLibraries(left: string, right: string): boolean {
  const leftKey = normalizeChartLibrary(left);
  const rightKey = normalizeChartLibrary(right);
  return leftKey === rightKey || (CHART_LIBRARY_ALIASES[leftKey] ?? []).includes(rightKey);
}

function normalizeChartLibrary(value: string): string {
  return value.trim().toLowerCase();
}
