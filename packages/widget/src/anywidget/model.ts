import type { AnyModel } from "@anywidget/types";
import type { ChatRequest, HistoryState, LensState, TargetSelector } from "@marimo-lens/protocol";

import { useModel } from "@anywidget/react";
import {
  parseChatsTrait,
  parseHistoryTrait,
  parseLensState,
  parseTargetSelector,
} from "@marimo-lens/protocol";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { LensProtocolClient } from "@/anywidget/client";

type LensModelFields = {
  _state: LensState;
  _history: HistoryState | null;
  _chats: ChatRequest[];
  _selector: TargetSelector;
  _css: string | undefined;
};

export type LensModel = {
  state: LensState;
  history: HistoryState | null;
  /** The runtime's open chat requests, oldest first. */
  chats: ChatRequest[];
  css: string;
  protocol: LensProtocolClient;
  selector: TargetSelector;
};

export function useLensModel(ownerWindow: Window): LensModel {
  const model = useModel<LensModelFields>();
  const state = useModelValue(model, "_state", parseLensState);
  const history = useModelValue(model, "_history", parseHistoryTrait);
  const chats = useModelValue(model, "_chats", parseChatsTrait);
  const selector = useModelValue(model, "_selector", parseTargetSelector);
  const css = useModelValue(model, "_css", parseCss);
  const protocol = useMemo(() => new LensProtocolClient(model, ownerWindow), [model, ownerWindow]);

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, history, chats, css, protocol, selector };
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

// A trait value that fails its contract keeps the last accepted value on
// screen, so a later valid value renders without remounting the view. With
// no accepted value yet the error reaches the view's error boundary.
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
    raw = next;
    try {
      accepted = { value: parse(next) };
    } catch (error) {
      if (!accepted) throw error;
      console.warn(`marimo-lens: ignored an invalid ${key} value`, error);
    }
    return accepted.value;
  };
}
