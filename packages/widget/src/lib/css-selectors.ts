export function cssEscape(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/["\\#.:,[\]>+~*=\s]/g, "\\$&");
}

export function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
