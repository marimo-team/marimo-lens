import type { AnyModel } from "@anywidget/types";

import { useModel, useModelState } from "@anywidget/react";
import { useEffect, useMemo } from "react";

import type { LensState } from "@/contracts";

import { parseLensState } from "@/contracts";
import { LensProtocolClient } from "@/protocol";

type LensModelFields = {
  _state: unknown;
  _lens_css: string;
};

export type LensModel = {
  state: LensState;
  lensCss: string;
  protocol: LensProtocolClient;
};

export function useLensModel(): LensModel {
  const model = useModel<LensModelFields>();
  const [rawState] = useModelState<unknown>("_state");
  const [lensCss] = useModelState<string>("_lens_css");
  const state = useMemo(() => parseLensState(rawState), [rawState]);
  const protocol = useMemo(() => new LensProtocolClient(model as AnyModel), [model]);

  useEffect(() => {
    protocol.start();
    return () => protocol.dispose();
  }, [protocol]);

  return { state, lensCss: lensCss ?? "", protocol };
}
