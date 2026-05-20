import { ancestryCrossingShadow } from "@/lib/shadow-dom";
import { chartLabel, classOrTag, dataAttributes, unit } from "@/selection/chart-units/chart-dom";
import type { ChartUnitMatch } from "@/selection/chart-units/chart-unit-adapter";
import type { LensChartPartKind, ViewportPoint } from "@/types";

type AxisOrientation = "x" | "y" | "unknown";
type SvgRole = LensChartPartKind;

type SvgBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  area: number;
};

type AxisEvidence = {
  orientation: AxisOrientation;
  labels: string[];
  tickCount: number;
};

type LegendEvidence = {
  labels: string[];
  swatchCount: number;
};

type SvgSceneNode = {
  element: Element;
  rect: SvgBox;
  role: SvgRole;
  label: string;
  detail?: string;
  datum?: Record<string, unknown>;
  score: number;
  context: Record<string, unknown>;
};

type SvgScene = {
  svg: Element;
  rect: SvgBox;
  nodes: SvgSceneNode[];
  nodeByElement: Map<Element, SvgSceneNode>;
};

type SeedNode = {
  element: Element;
  rect: SvgBox;
  tag: string;
  text: string;
  explicitRole: SvgRole | null;
};

type AxisCluster = {
  orientation: AxisOrientation;
  labels: string[];
  textElements: Set<Element>;
  tickElements: Set<Element>;
};

type LegendCluster = {
  labels: string[];
  markElements: Set<Element>;
  textElements: Set<Element>;
};

const MARK_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon,use";
const TEXT_SELECTOR = "text";
const ROLE_CONTAINER_SELECTOR = "g,[role],[aria-label],[data-role],[data-testid],[data-name]";
const ALIGNMENT_EPSILON = 8;
const AXIS_EDGE_RATIO = 0.22;
const LEGEND_PAIR_DISTANCE = 48;

export function resolveGenericSvgSceneMatch(
  element: Element,
  point?: ViewportPoint,
): ChartUnitMatch | null {
  const svg = closestSvg(element);
  if (!svg) return null;
  const scene = parseGenericSvgScene(svg);
  const node = pickSceneNode(scene, element, point);

  if (node) {
    return {
      element: node.element,
      unit: unit("visual", node.role, node.label, node.detail, node.datum),
      score: node.score,
      context: node.context,
    };
  }

  return {
    element: svg,
    unit: unit("visual", "plot-area", "plot area", classOrTag(svg)),
    score: 54,
    context: genericSvgContext(svg, scene.rect, "plot-area"),
  };
}

function parseGenericSvgScene(svg: Element): SvgScene {
  const rect = toBox(svg.getBoundingClientRect());
  const seedNodes = collectSeedNodes(svg);
  const axisClusters = inferAxisClusters(seedNodes, rect);
  const legendClusters = inferLegendClusters(seedNodes, axisClusters);
  const nodes = seedNodes.map((seed) => sceneNodeFor(seed, rect, axisClusters, legendClusters));
  const nodeByElement = new Map(nodes.map((node) => [node.element, node]));
  return { svg, rect, nodes, nodeByElement };
}

function collectSeedNodes(svg: Element): SeedNode[] {
  const seeds = new Map<Element, SeedNode>();
  const add = (element: Element) => {
    if (seeds.has(element) || isIgnoredSvgElement(element)) return;
    const rect = toBox(element.getBoundingClientRect());
    if (!isUsableBox(rect) && element !== svg) return;
    seeds.set(element, {
      element,
      rect,
      tag: element.tagName.toLowerCase(),
      text: normalizedText(element),
      explicitRole: explicitSvgRole(element, svg),
    });
  };

  for (const element of svg.querySelectorAll(
    `${ROLE_CONTAINER_SELECTOR},${TEXT_SELECTOR},${MARK_SELECTOR}`,
  )) {
    if (!(element instanceof Element)) continue;
    const explicitRole = explicitSvgRole(element, svg);
    if (element.matches(TEXT_SELECTOR) || element.matches(MARK_SELECTOR) || explicitRole) {
      add(element);
    }
  }

  return [...seeds.values()];
}

function sceneNodeFor(
  seed: SeedNode,
  svgBox: SvgBox,
  axisClusters: AxisCluster[],
  legendClusters: LegendCluster[],
): SvgSceneNode {
  const axis = axisFor(seed.element, axisClusters);
  if (seed.explicitRole === "axis" || axis) {
    const evidence = axis ?? explicitAxisEvidence(seed, svgBox);
    return {
      element: seed.element,
      rect: seed.rect,
      role: "axis",
      label: axisLabel(evidence.orientation),
      detail: axisDetail(seed, evidence),
      score: seed.explicitRole === "axis" ? 84 : 80,
      context: {
        ...genericSvgContext(seed.element, seed.rect, "axis"),
        axis: evidence,
      },
    };
  }

  const legend = legendFor(seed.element, legendClusters);
  if (seed.explicitRole === "legend" || legend) {
    const evidence = legend ?? explicitLegendEvidence(seed);
    return {
      element: seed.element,
      rect: seed.rect,
      role: "legend",
      label: "legend",
      detail: legendDetail(seed, evidence),
      score: seed.explicitRole === "legend" ? 84 : 80,
      context: {
        ...genericSvgContext(seed.element, seed.rect, "legend"),
        legend: evidence,
      },
    };
  }

  const textRole = inferredTextRole(seed, svgBox);
  if (seed.explicitRole === "title" || textRole === "title") {
    return {
      element: seed.element,
      rect: seed.rect,
      role: "title",
      label: "title",
      detail: firstUsefulText(seed, "title"),
      score: seed.explicitRole === "title" ? 82 : 78,
      context: genericSvgContext(seed.element, seed.rect, "title"),
    };
  }

  if (seed.explicitRole === "annotation" || textRole === "annotation") {
    return {
      element: seed.element,
      rect: seed.rect,
      role: "annotation",
      label: firstUsefulText(seed, "annotation"),
      detail: classOrTag(seed.element),
      score: seed.explicitRole === "annotation" ? 82 : 78,
      context: genericSvgContext(seed.element, seed.rect, "annotation"),
    };
  }

  const role = seed.explicitRole ?? visualRole(seed);
  const datum = dataAttributes(seed.element);
  return {
    element: seed.element,
    rect: seed.rect,
    role,
    label: visualLabel(seed, role),
    detail: visualDetail(seed),
    datum,
    score: seed.explicitRole ? 82 : role === "trace" ? 80 : 80,
    context: {
      ...genericSvgContext(seed.element, seed.rect, role),
      visual: {
        tag: seed.tag,
        text: seed.text || undefined,
      },
    },
  };
}

function inferAxisClusters(seeds: SeedNode[], svgBox: SvgBox): AxisCluster[] {
  const textSeeds = seeds.filter((seed) => seed.tag === "text" && seed.text);
  const markSeeds = seeds.filter((seed) => isMarkTag(seed.tag));
  const clusters: AxisCluster[] = [];

  for (const group of alignedGroups(textSeeds, (seed) => seed.rect.centerY)) {
    const axis = axisClusterFor(group, markSeeds, svgBox, "x");
    if (axis) clusters.push(axis);
  }

  for (const group of alignedGroups(textSeeds, (seed) => seed.rect.centerX)) {
    const axis = axisClusterFor(group, markSeeds, svgBox, "y");
    if (axis) clusters.push(axis);
  }

  return dedupeAxisClusters(clusters);
}

function axisClusterFor(
  group: SeedNode[],
  markSeeds: SeedNode[],
  svgBox: SvgBox,
  orientation: Exclude<AxisOrientation, "unknown">,
): AxisCluster | null {
  if (group.length < 2) return null;
  const spread = orientation === "x" ? spreadBy(group, "centerX") : spreadBy(group, "centerY");
  const coverage = spread / Math.max(1, orientation === "x" ? svgBox.width : svgBox.height);
  const edgeDistance =
    orientation === "x"
      ? Math.min(
          Math.abs(meanBy(group, (seed) => seed.rect.centerY) - svgBox.top),
          Math.abs(meanBy(group, (seed) => seed.rect.centerY) - svgBox.bottom),
        )
      : Math.min(
          Math.abs(meanBy(group, (seed) => seed.rect.centerX) - svgBox.left),
          Math.abs(meanBy(group, (seed) => seed.rect.centerX) - svgBox.right),
        );
  const nearEdge =
    edgeDistance <= (orientation === "x" ? svgBox.height : svgBox.width) * AXIS_EDGE_RATIO;
  const ticks = matchingAxisTicks(group, markSeeds, orientation);
  const enoughTickEvidence = ticks.size >= Math.max(1, group.length - 1);
  if (coverage < 0.24 && !enoughTickEvidence) return null;
  if (!nearEdge && !enoughTickEvidence) return null;

  return {
    orientation,
    labels: group
      .map((seed) => seed.text)
      .filter(Boolean)
      .slice(0, 12),
    textElements: new Set(group.map((seed) => seed.element)),
    tickElements: ticks,
  };
}

function matchingAxisTicks(
  textGroup: SeedNode[],
  markSeeds: SeedNode[],
  orientation: Exclude<AxisOrientation, "unknown">,
): Set<Element> {
  const ticks = new Set<Element>();
  for (const mark of markSeeds) {
    if (looksLikeBackground(mark)) continue;
    const closeText = textGroup.some((text) => {
      const aligned =
        orientation === "x"
          ? Math.abs(text.rect.centerX - mark.rect.centerX) <= 7
          : Math.abs(text.rect.centerY - mark.rect.centerY) <= 7;
      const gap =
        orientation === "x"
          ? Math.min(
              Math.abs(text.rect.top - mark.rect.bottom),
              Math.abs(mark.rect.top - text.rect.bottom),
            )
          : Math.min(
              Math.abs(text.rect.left - mark.rect.right),
              Math.abs(mark.rect.left - text.rect.right),
            );
      return aligned && gap <= 34;
    });
    if (
      (closeText && looksLikeTickCandidate(mark, orientation)) ||
      looksLikeAxisDomain(mark, textGroup, orientation)
    ) {
      ticks.add(mark.element);
    }
  }
  return ticks;
}

function inferLegendClusters(seeds: SeedNode[], axisClusters: AxisCluster[]): LegendCluster[] {
  const axisElements = new Set(
    axisClusters.flatMap((axis) => [...axis.textElements, ...axis.tickElements]),
  );
  const textSeeds = seeds.filter(
    (seed) => seed.tag === "text" && seed.text && !axisElements.has(seed.element),
  );
  const markSeeds = seeds.filter(
    (seed) => isMarkTag(seed.tag) && !axisElements.has(seed.element) && !looksLikeBackground(seed),
  );
  const pairs: Array<{ mark: SeedNode; text: SeedNode }> = [];

  for (const text of textSeeds) {
    const mark = nearestLegendMark(text, markSeeds);
    if (mark) pairs.push({ mark, text });
  }

  const groups = groupLegendPairs(pairs);
  return groups
    .filter((group) => group.length >= 2)
    .map((group) => ({
      labels: group.map((pair) => pair.text.text).slice(0, 12),
      markElements: new Set(group.map((pair) => pair.mark.element)),
      textElements: new Set(group.map((pair) => pair.text.element)),
    }));
}

function nearestLegendMark(text: SeedNode, marks: SeedNode[]): SeedNode | null {
  let best: { distance: number; mark: SeedNode } | null = null;
  for (const mark of marks) {
    if (mark.rect.area > text.rect.area * 16 && mark.rect.area > 1600) continue;
    const alignedY =
      Math.abs(mark.rect.centerY - text.rect.centerY) <= Math.max(10, text.rect.height);
    const alignedX =
      Math.abs(mark.rect.centerX - text.rect.centerX) <= Math.max(10, text.rect.width);
    if (!alignedY && !alignedX) continue;
    const distance = boxDistance(text.rect, mark.rect);
    if (distance > LEGEND_PAIR_DISTANCE) continue;
    if (!best || distance < best.distance) best = { distance, mark };
  }
  return best?.mark ?? null;
}

function groupLegendPairs(
  pairs: Array<{ mark: SeedNode; text: SeedNode }>,
): Array<Array<{ mark: SeedNode; text: SeedNode }>> {
  const groups = new Map<Element, Array<{ mark: SeedNode; text: SeedNode }>>();
  for (const pair of pairs) {
    const key = closestSharedContainer(pair.text.element, pair.mark.element);
    const group = groups.get(key);
    if (group) {
      group.push(pair);
    } else {
      groups.set(key, [pair]);
    }
  }
  return [...groups.values()];
}

function axisFor(element: Element, clusters: AxisCluster[]): AxisEvidence | null {
  for (const cluster of clusters) {
    if (cluster.textElements.has(element) || cluster.tickElements.has(element)) {
      return {
        orientation: cluster.orientation,
        labels: cluster.labels,
        tickCount: cluster.textElements.size,
      };
    }
  }
  return null;
}

function legendFor(element: Element, clusters: LegendCluster[]): LegendEvidence | null {
  for (const cluster of clusters) {
    if (cluster.textElements.has(element) || cluster.markElements.has(element)) {
      return {
        labels: cluster.labels,
        swatchCount: cluster.markElements.size,
      };
    }
  }
  return null;
}

function pickSceneNode(
  scene: SvgScene,
  element: Element,
  point?: ViewportPoint,
): SvgSceneNode | null {
  for (const candidate of ancestryCrossingShadow(element)) {
    const node = scene.nodeByElement.get(candidate);
    if (node) return node;
    if (candidate === scene.svg) break;
  }

  if (!point) return null;

  const hits = scene.nodes.filter((node) => pointInside(node.rect, point, hitPadding(node.role)));
  hits.sort((left, right) => {
    const roleDifference = roleRank(right.role) - roleRank(left.role);
    if (roleDifference !== 0) return roleDifference;
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;
    return left.rect.area - right.rect.area;
  });
  return hits[0] ?? null;
}

function explicitSvgRole(element: Element, svg: Element): SvgRole | null {
  const hint = semanticHint(element, svg);
  if (hasToken(hint, ["legend", "swatch", "legenditem", "legend-item"])) return "legend";
  if (hasToken(hint, ["axis", "tick", "gridline", "grid-line", "domain"])) return "axis";
  if (hasToken(hint, ["title", "headline"])) return "title";
  if (hasToken(hint, ["annotation", "callout", "label"])) return "annotation";
  if (hasToken(hint, ["trace", "series", "line-series"])) return "trace";
  if (hasToken(hint, ["mark", "bar", "point", "symbol", "area", "arc"])) return "mark";
  return null;
}

function explicitAxisEvidence(seed: SeedNode, svgBox: SvgBox): AxisEvidence {
  return {
    orientation: axisOrientation(seed, svgBox),
    labels: labelList(seed.element),
    tickCount: Math.max(1, seed.element.querySelectorAll(TEXT_SELECTOR).length),
  };
}

function explicitLegendEvidence(seed: SeedNode): LegendEvidence {
  return {
    labels: labelList(seed.element),
    swatchCount: seed.element.querySelectorAll(MARK_SELECTOR).length,
  };
}

function inferredTextRole(seed: SeedNode, svgBox: SvgBox): "annotation" | "title" | null {
  if (seed.tag !== "text") return null;
  const nearTop = seed.rect.centerY <= svgBox.top + svgBox.height * 0.18;
  const horizontallyCentered =
    seed.rect.centerX >= svgBox.left + svgBox.width * 0.2 &&
    seed.rect.centerX <= svgBox.right - svgBox.width * 0.2;
  if (nearTop && horizontallyCentered) return "title";
  return "annotation";
}

function visualRole(seed: SeedNode): "mark" | "trace" {
  if (seed.tag === "line" || seed.tag === "polyline") return "trace";
  if (seed.tag === "path" && !isClosedPath(seed.element.getAttribute("d"))) return "trace";
  return "mark";
}

function visualLabel(seed: SeedNode, role: SvgRole): string {
  if (role === "trace") {
    if (seed.tag === "polyline" || seed.tag === "line") return "line trace";
    return "path trace";
  }
  if (seed.tag === "rect") return "bar";
  if (seed.tag === "circle" || seed.tag === "ellipse") return "point";
  if (seed.tag === "polygon") return "shape";
  if (seed.tag === "path") return isClosedPath(seed.element.getAttribute("d")) ? "shape" : "path";
  return role === "mark" ? "mark" : role;
}

function visualDetail(seed: SeedNode): string {
  return firstUsefulText(seed, classOrTag(seed.element));
}

function axisLabel(orientation: AxisOrientation): string {
  if (orientation === "x") return "x axis";
  if (orientation === "y") return "y axis";
  return "axis";
}

function axisDetail(seed: SeedNode, evidence: AxisEvidence): string {
  const label = firstUsefulText(seed, "");
  if (label && label !== axisLabel(evidence.orientation)) return label;
  if (evidence.labels.length > 0) return `${evidence.labels.slice(0, 4).join(", ")} axis`;
  return classOrTag(seed.element);
}

function legendDetail(seed: SeedNode, evidence: LegendEvidence): string {
  if (evidence.labels.length > 0) return evidence.labels.slice(0, 4).join(", ");
  return firstUsefulText(seed, classOrTag(seed.element));
}

function genericSvgContext(element: Element, rect: SvgBox, role: SvgRole): Record<string, unknown> {
  return {
    chartParser: "generic-svg",
    element: {
      tag: element.tagName.toLowerCase(),
      selector: classOrTag(element),
    },
    role,
    bounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function alignedGroups<T>(items: T[], value: (item: T) => number): T[][] {
  const sorted = [...items].sort((left, right) => value(left) - value(right));
  const groups: T[][] = [];
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    if (!current) {
      groups.push([item]);
      continue;
    }
    const center = meanBy(current, value);
    if (Math.abs(value(item) - center) <= ALIGNMENT_EPSILON) {
      current.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

function dedupeAxisClusters(clusters: AxisCluster[]): AxisCluster[] {
  const seen = new Set<string>();
  const deduped: AxisCluster[] = [];
  for (const cluster of clusters.sort((left, right) => right.labels.length - left.labels.length)) {
    const key = [...cluster.textElements]
      .map((element) => element.textContent?.trim() ?? "")
      .join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cluster);
  }
  return deduped;
}

function axisOrientation(seed: SeedNode, svgBox: SvgBox): AxisOrientation {
  const hint = semanticHint(seed.element, seed.element);
  if (hasToken(hint, ["x", "xaxis", "x-axis", "bottom", "top"])) return "x";
  if (hasToken(hint, ["y", "yaxis", "y-axis", "left", "right"])) return "y";
  const horizontalEdge = Math.min(
    Math.abs(seed.rect.centerY - svgBox.top),
    Math.abs(seed.rect.centerY - svgBox.bottom),
  );
  const verticalEdge = Math.min(
    Math.abs(seed.rect.centerX - svgBox.left),
    Math.abs(seed.rect.centerX - svgBox.right),
  );
  if (horizontalEdge < verticalEdge) return "x";
  if (verticalEdge < horizontalEdge) return "y";
  return "unknown";
}

function looksLikeAxisDomain(
  mark: SeedNode,
  textGroup: SeedNode[],
  orientation: Exclude<AxisOrientation, "unknown">,
): boolean {
  if (mark.rect.width < 2 && mark.rect.height < 2) return false;
  const textBounds = unionBoxes(textGroup.map((seed) => seed.rect));
  if (orientation === "x") {
    const spansGroup = mark.rect.left <= textBounds.right && mark.rect.right >= textBounds.left;
    const close = Math.min(
      Math.abs(mark.rect.top - textBounds.bottom),
      Math.abs(mark.rect.bottom - textBounds.top),
    );
    return spansGroup && mark.rect.width >= textBounds.width * 0.5 && close <= 36;
  }
  const spansGroup = mark.rect.top <= textBounds.bottom && mark.rect.bottom >= textBounds.top;
  const close = Math.min(
    Math.abs(mark.rect.left - textBounds.right),
    Math.abs(mark.rect.right - textBounds.left),
  );
  return spansGroup && mark.rect.height >= textBounds.height * 0.5 && close <= 36;
}

function looksLikeTickCandidate(
  mark: SeedNode,
  orientation: Exclude<AxisOrientation, "unknown">,
): boolean {
  if (mark.tag === "line" || mark.tag === "path") return true;
  const thinVertical = mark.rect.height >= 4 && mark.rect.width <= 4;
  const thinHorizontal = mark.rect.width >= 4 && mark.rect.height <= 4;
  return orientation === "x" ? thinVertical : thinHorizontal;
}

function looksLikeBackground(seed: SeedNode): boolean {
  if (seed.tag !== "rect") return false;
  const hint = semanticHint(seed.element, seed.element);
  return hasToken(hint, ["background", "plot-background", "canvas", "frame"]);
}

function closestSharedContainer(left: Element, right: Element): Element {
  const leftAncestors = ancestryCrossingShadow(left);
  const rightAncestors = new Set(ancestryCrossingShadow(right));
  return leftAncestors.find((element) => rightAncestors.has(element)) ?? left;
}

function semanticHint(element: Element, stopAt: Element): string {
  const values: string[] = [];
  for (const current of ancestryCrossingShadow(element)) {
    values.push(
      current.getAttribute("id") ?? "",
      current.getAttribute("class") ?? "",
      current.getAttribute("role") ?? "",
      current.getAttribute("aria-label") ?? "",
      current.getAttribute("data-role") ?? "",
      current.getAttribute("data-testid") ?? "",
      current.getAttribute("data-name") ?? "",
    );
    if (current === stopAt) break;
  }
  return values.join(" ").toLowerCase();
}

function labelList(element: Element): string[] {
  return [...element.querySelectorAll(TEXT_SELECTOR)]
    .map((text) => normalizedText(text))
    .filter(Boolean)
    .slice(0, 12);
}

function firstUsefulText(seed: SeedNode, fallback: string): string {
  return chartLabel(seed.element, seed.text || fallback || classOrTag(seed.element));
}

function normalizedText(element: Element): string {
  return element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
}

function isClosedPath(pathData: string | null): boolean {
  return /z\s*$/i.test(pathData?.trim() ?? "");
}

function isMarkTag(tag: string): boolean {
  return MARK_SELECTOR.split(",").includes(tag);
}

function isIgnoredSvgElement(element: Element): boolean {
  return Boolean(element.closest("defs,clipPath,mask,metadata,pattern,script,style,symbol"));
}

function hasToken(hint: string, tokens: string[]): boolean {
  return tokens.some((token) => {
    const escaped = token.replace(/-/g, "[-_\\s]?");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hint);
  });
}

function toBox(rect: DOMRect): SvgBox {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  const width = right - left;
  const height = bottom - top;
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    area: Math.max(1, width * height),
  };
}

function isUsableBox(rect: SvgBox): boolean {
  return rect.width >= 1 || rect.height >= 1;
}

function pointInside(rect: SvgBox, point: ViewportPoint, padding: number): boolean {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

function hitPadding(role: SvgRole): number {
  return role === "axis" || role === "trace" ? 5 : 3;
}

function roleRank(role: SvgRole): number {
  if (role === "mark" || role === "trace") return 5;
  if (role === "legend" || role === "axis") return 4;
  if (role === "title" || role === "annotation") return 3;
  return 1;
}

function boxDistance(left: SvgBox, right: SvgBox): number {
  const dx = Math.max(0, left.left - right.right, right.left - left.right);
  const dy = Math.max(0, left.top - right.bottom, right.top - left.bottom);
  return Math.hypot(dx, dy);
}

function unionBoxes(boxes: SvgBox[]): SvgBox {
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return toBox(new DOMRect(left, top, right - left, bottom - top));
}

function spreadBy(seeds: SeedNode[], key: "centerX" | "centerY"): number {
  const values = seeds.map((seed) => seed.rect[key]);
  return Math.max(...values) - Math.min(...values);
}

function meanBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0) / Math.max(1, items.length);
}

function closestSvg(element: Element): Element | null {
  return (
    ancestryCrossingShadow(element).find(
      (candidate) => candidate.tagName.toLowerCase() === "svg",
    ) ?? null
  );
}
