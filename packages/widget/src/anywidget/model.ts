import type { AnyModel } from "@anywidget/types";
import type { LensState, TargetSelector } from "@marimo-lens/protocol";

import { useModel } from "@anywidget/react";
import { parseLensState, parseTargetSelector } from "@marimo-lens/protocol";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { LensProtocolClient } from "@/anywidget/client";

type LensModelFields = {
  _state: LensState;
  _selector: TargetSelector;
  _css: string | undefined;
};

export type LensModel = {
  state: LensState;
  css: string;
  protocol: LensProtocolClient;
  selector: TargetSelector;
};

export function useLensModel(ownerWindow: Window): LensModel {
  const model = useModel<LensModelFields>();
  const rawState = useModelValue(model, "_state");
  const rawSelector = useModelValue(model, "_selector");
  const css = useModelValue(model, "_css");
  const state = useMemo(() => parseLensState(rawState), [rawState]);
  const selector = useMemo(() => parseTargetSelector(rawSelector), [rawSelector]);
  const protocol = useMemo(() => new LensProtocolClient(model, ownerWindow), [model, ownerWindow]);

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, css: css ?? "", protocol, selector };
}

function useModelValue<Key extends keyof LensModelFields>(
  model: AnyModel<LensModelFields>,
  key: Key,
): LensModelFields[Key] {
  // Hosts can retain subscription teardown callbacks until the view closes.
  const subscribe = useCallback(
    (update: () => void) => {
      model.on(`change:${key}`, update);
      return () => model.off(`change:${key}`, update);
    },
    [model, key],
  );
  const getSnapshot = useCallback(() => model.get(key), [model, key]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
