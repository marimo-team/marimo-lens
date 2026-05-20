import { isMediaTarget } from "@/lib/column-targeting";
import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

const MEDIA_SELECTOR =
  "img,video,audio,picture,canvas,[data-marimo-media],[data-mime^='image/'],[data-mime^='audio/'],[data-mime^='video/']";

export const mediaSelectionPlugin = defineSelectionPlugin({
  id: "media",
  surface: "media",
  priority: 825,
  select: ({ element, targets }) => {
    const surface = closestCrossingShadow(element, MEDIA_SELECTOR);
    if (!surface) return null;
    const mediaTargets = targets.filter(isMediaTarget);
    if (mediaTargets.length !== 1) return null;
    return {
      target: mediaTargets[0],
      semanticSelection: surfaceSemanticSelection({
        target: mediaTargets[0],
        element: surface,
        sourceElement: element,
        kind: "media-surface",
        granularity: "surface",
        hitKind: "media-surface",
        selector: describeSurface(surface),
        data: {
          surface: "media",
          surfaceSelector: describeSurface(surface),
        },
      }),
      score: 74,
    };
  },
});

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  const mime = element.getAttribute("data-mime");
  if (mime) return `[data-mime="${mime}"]`;
  return element.tagName.toLowerCase();
}
