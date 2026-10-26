import { expect, test } from "vite-plus/test";

import { formatWhen } from "@/ui/relative-time";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
const iso = (time: number) => new Date(time).toISOString();

test.each([
  { when: "just now", from: at(21, 10, 0), now: at(21, 10, 0) + 30_000 },
  { when: "4 min. ago", from: at(21, 10, 0), now: at(21, 10, 4) },
  { when: "2 hr. ago", from: at(21, 8, 0), now: at(21, 10, 30) },
  { when: "yesterday", from: at(20, 9, 0), now: at(21, 12, 0) },
  { when: "Oct 19", from: at(19, 23, 0), now: at(21, 8, 0) },
])("formatWhen says $when", ({ when, from, now }) => {
  expect(formatWhen(iso(from), now)).toBe(when);
});
