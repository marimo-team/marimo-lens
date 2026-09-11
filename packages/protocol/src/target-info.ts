/** Optional consumer-authored text displayed while a Lens target is being picked. */
export interface TargetInfo {
  label: string;
  detail?: string;
}

export const TARGET_LABEL_ATTRIBUTE = "data-marimo-lens-label";
export const TARGET_DETAIL_ATTRIBUTE = "data-marimo-lens-detail";
