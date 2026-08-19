import type { LensState, TargetSelector } from "@marimo-lens/protocol";

import { useModel, useModelState } from "@anywidget/react";
import { parseLensState, parseTargetSelector } from "@marimo-lens/protocol";
import { useEffect, useMemo } from "react";

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
  const [rawState] = useModelState<LensState>("_state");
  const [rawSelector] = useModelState<TargetSelector>("_selector");
  const [css] = useModelState<string | undefined>("_css");
  const state = useMemo(() => parseLensState(rawState), [rawState]);
  const selector = useMemo(() => parseTargetSelector(rawSelector), [rawSelector]);
  const protocol = useMemo(() => new LensProtocolClient(model, ownerWindow), [model, ownerWindow]);

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, css: css ?? "", protocol, selector };
}
