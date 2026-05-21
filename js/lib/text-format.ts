export function formatCount(count: number, label: string): string {
  return `${count.toLocaleString()} ${plural(label, count)}`;
}

export function plural(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
