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
  const state = useModelValue(model, "_state", parseLensState);
  const selector = useModelValue(model, "_selector", parseTargetSelector);
  const css = useModelValue(model, "_css", parseCss);
  const protocol = useMemo(() => new LensProtocolClient(model, ownerWindow), [model, ownerWindow]);

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, css, protocol, selector };
}

function parseCss(value: string | undefined): string {
  return value ?? "";
}

function useModelValue<Key extends keyof LensModelFields, Value>(
  model: AnyModel<LensModelFields>,
  key: Key,
  parse: (value: LensModelFields[Key]) => Value,
): Value {
  // Hosts can retain subscription teardown callbacks until the view closes.
  const subscribe = useCallback(
    (update: () => void) => {
      model.on(`change:${key}`, update);
      return () => model.off(`change:${key}`, update);
    },
    [model, key],
  );
  const getSnapshot = useMemo(() => acceptedValue(model, key, parse), [model, key, parse]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Parse each new trait value once, so the store hands React a stable snapshot.
// A value that fails its contract throws to the view's error boundary.
function acceptedValue<Key extends keyof LensModelFields, Value>(
  model: AnyModel<LensModelFields>,
  key: Key,
  parse: (value: LensModelFields[Key]) => Value,
): () => Value {
  let raw: LensModelFields[Key] | undefined;
  let accepted: { value: Value } | null = null;
  return () => {
    const next = model.get(key);
    if (accepted && next === raw) return accepted.value;
    accepted = { value: parse(next) };
    raw = next;
    return accepted.value;
  };
}
