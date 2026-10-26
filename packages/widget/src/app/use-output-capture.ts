import type { captureOutputSnapshot } from "@marimo-lens/image-capture";

import { useEffect } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { LensProtocolError, type LensProtocolClient } from "@/anywidget/client";

export function useOutputCapture(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
  capture: typeof captureOutputSnapshot,
): void {
  useEffect(
    () =>
      protocol.onOutputCapture(async (command, signal) => {
        await dom.afterNextPaint(signal);
        const output = dom.getOutputCell(command.payload.outputCellId);
        if (!output) {
          throw new LensProtocolError(
            "output_unavailable",
            `Output ${command.payload.outputCellId} is unavailable`,
          );
        }
        const element = output.element;
        const result = await capture({
          imageId: `image:${command.requestId}`,
          output: element,
          signal,
        });
        const current = dom.getOutputCell(command.payload.outputCellId);
        if (!element.isConnected || current?.element !== element) {
          throw new LensProtocolError(
            "capture_failed",
            "The output changed before capture completed",
          );
        }
        return {
          image: result.metadata,
          bytes: result.bytes,
        };
      }),
    [capture, dom, protocol],
  );
}
