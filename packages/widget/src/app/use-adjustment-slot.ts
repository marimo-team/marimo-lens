import { useCallback, useEffect, useRef } from "react";

import type { AdjustmentCancel, AdjustmentSlot } from "@/selection/components/adjustment";

type AdjustmentSlotOwner = AdjustmentSlot & {
  cancelAdjustment: () => boolean;
};

export function useAdjustmentSlot(): AdjustmentSlotOwner {
  const activeAdjustment = useRef<AdjustmentCancel | null>(null);

  const registerAdjustment = useCallback((cancel: AdjustmentCancel) => {
    activeAdjustment.current?.();
    activeAdjustment.current = cancel;
  }, []);
  const releaseAdjustment = useCallback((cancel: AdjustmentCancel) => {
    if (activeAdjustment.current === cancel) activeAdjustment.current = null;
  }, []);
  const cancelAdjustment = useCallback(() => {
    const cancel = activeAdjustment.current;
    if (!cancel) return false;
    activeAdjustment.current = null;
    cancel();
    return true;
  }, []);

  useEffect(
    () => () => {
      activeAdjustment.current?.();
      activeAdjustment.current = null;
    },
    [],
  );

  return { registerAdjustment, releaseAdjustment, cancelAdjustment };
}
