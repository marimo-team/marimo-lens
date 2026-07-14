import { useEffect, useMemo, useState } from "react";

import type { AgentActivity } from "@/types";

import {
  agentActivityVisualExpiry,
  agentCellMarks,
  type AgentCellMark,
} from "@/lib/agent-activity";
import { cellElement, isUsableRegion, paddedRect } from "@/lib/cell-regions";
import { scrollableAncestors } from "@/lib/scroll-ancestors";

export type AgentActivityRegion = AgentCellMark & {
  key: string;
  rect: DOMRect;
};

export function useAgentActivityRegions(activity: AgentActivity[]): AgentActivityRegion[] {
  const [now, setNow] = useState(() => Date.now());
  const marks = useMemo(() => agentCellMarks(activity, { now }), [activity, now]);
  const signature = agentMarksSignature(marks);
  const [regions, setRegions] = useState<AgentActivityRegion[]>([]);

  useEffect(() => {
    const expiry = agentActivityVisualExpiry(activity);
    if (expiry === null) return undefined;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiry - Date.now()) + 20,
    );
    return () => window.clearTimeout(timeout);
  }, [activity]);

  useEffect(() => {
    if (signature === "") {
      setRegions([]);
      return undefined;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      setRegions(measureAgentRegions(marks));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    const elements = marks
      .map((mark) => cellElement(mark.cellId, "cell"))
      .filter((element): element is Element => element !== null);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(document.body);
    for (const element of elements) {
      resizeObserver?.observe(element);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutationObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-cell-id", "hidden", "id", "style"],
      childList: true,
      subtree: true,
    });
    const scrollTargets = [...new Set(elements.flatMap((element) => scrollableAncestors(element)))];
    for (const target of scrollTargets) {
      target.addEventListener("scroll", schedule, { passive: true });
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      for (const target of scrollTargets) {
        target.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [marks, signature]);

  return regions;
}

function measureAgentRegions(marks: AgentCellMark[]): AgentActivityRegion[] {
  return marks
    .map((mark) => {
      const element = cellElement(mark.cellId, "cell");
      return element
        ? {
            ...mark,
            key: `${mark.cellId}:${mark.kind}:${mark.activityKind}:${mark.activityId}:${mark.activityCreatedAt}`,
            rect: paddedRect(element.getBoundingClientRect(), 4),
          }
        : null;
    })
    .filter((region): region is AgentActivityRegion => region !== null)
    .filter((region) => isUsableRegion(region.rect));
}

function agentMarksSignature(marks: AgentCellMark[]): string {
  return marks
    .map(
      (mark) =>
        `${mark.cellId}:${mark.kind}:${mark.activityKind}:${mark.activityId}:${mark.activityCreatedAt}`,
    )
    .sort()
    .join("|");
}
