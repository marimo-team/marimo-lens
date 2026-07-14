export function boundedUtf16(value: string, maximum: number): string {
  const bounded = value.slice(0, maximum);
  if (bounded.length === 0) return bounded;
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
}
