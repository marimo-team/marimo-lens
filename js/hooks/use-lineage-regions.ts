import { useEffect, useState } from "react";

import type { LineageSummary } from "@/lib/lineage";

import { cellElement, isUsableRegion, paddedRect } from "@/lib/cell-regions";

type LineageRole = "downstream" | "focus" | "upstream";

type LineageRegion = {
  cellId: string;
  rect: DOMRect;
  role: LineageRole;
};

const MAX_REGIONS_PER_SIDE = 4;

export function useLineageRegions(lineage: LineageSummary | null): LineageRegion[] {
  const signature = lineageSignature(lineage);
  const [regions, setRegions] = useState<LineageRegion[]>([]);

  useEffect(() => {
    if (!lineage || signature === "") {
      setRegions([]);
      return undefined;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      setRegions(measureRegions(lineage));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [lineage, signature]);

  return regions;
}

function measureRegions(lineage: LineageSummary): LineageRegion[] {
  const regions = [
    ...regionsFor("upstream", lineage.upstreamCellIds.slice(0, MAX_REGIONS_PER_SIDE)),
    ...regionsFor("focus", lineage.focusCellIds),
    ...regionsFor("downstream", lineage.downstreamCellIds.slice(0, MAX_REGIONS_PER_SIDE)),
  ];
  return regions.filter((region) => isUsableRegion(region.rect));
}

function regionsFor(role: LineageRole, cellIds: string[]): LineageRegion[] {
  return cellIds
    .map((cellId) => {
      const element = cellElement(cellId);
      return element ? { cellId, rect: paddedRect(element.getBoundingClientRect()), role } : null;
    })
    .filter((region): region is LineageRegion => region !== null);
}

function lineageSignature(lineage: LineageSummary | null): string {
  if (!lineage) return "";
  return [
    lineage.focusCellIds.join(","),
    lineage.upstreamCellIds.join(","),
    lineage.downstreamCellIds.join(","),
  ].join("|");
}
