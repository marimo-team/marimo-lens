import type { AnyModel } from "@anywidget/types";
import type { LensState } from "@marimo-lens/protocol";

import { useModel, useModelState } from "@anywidget/react";
import { parseLensState } from "@marimo-lens/protocol";
import { useEffect, useMemo } from "react";

import { LensProtocolClient } from "@/anywidget/client";

type LensModelFields = {
  _state: unknown;
  _css: string | undefined;
};

export type LensModel = {
  state: LensState;
  css: string;
  protocol: LensProtocolClient;
};

export function useLensModel(ownerWindow: Window): LensModel {
  const model = useModel<LensModelFields>();
  const [rawState] = useModelState<unknown>("_state");
  const [css] = useModelState<string | undefined>("_css");
  const state = useMemo(() => parseLensState(rawState), [rawState]);
  const protocol = useMemo(
    () => new LensProtocolClient(model as AnyModel, ownerWindow),
    [model, ownerWindow],
  );

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, css: css ?? "", protocol };
}
