// Lens writes its interface in English, so times read in English beside it.
const LOCALE = "en";
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });
const day = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });
const dayInYear = new Intl.DateTimeFormat(LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const exact = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Say when something happened relative to `now`: "just now", "4 min. ago", "yesterday", "Sep 8". */
export function formatWhen(value: string, now: number): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const elapsed = now - time;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  const date = new Date(time);
  if (calendarDays(date, new Date(now)) === 1) return relative.format(-1, "day");
  return date.getFullYear() === new Date(now).getFullYear()
    ? day.format(date)
    : dayInYear.format(date);
}

/** Give the exact time for a title or a detail line. */
export function formatExactTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : exact.format(new Date(time));
}

function calendarDays(earlier: Date, later: Date): number {
  const start = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const end = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((end - start) / DAY);
}
