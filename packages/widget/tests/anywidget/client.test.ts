import type { AnyModel } from "@anywidget/types";
import type { LensCommand, OutputCaptureCommand } from "@marimo-lens/protocol";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { LensProtocolClient, LensProtocolError, type OutputCaptureAsset } from "@/anywidget/client";

import { selectionFixture } from "../support/fixtures";

type MessageHandler = (message: unknown, buffers: DataView[]) => void;
type SentMessage = { message: unknown; buffers: ArrayBuffer[] };

const models: FakeModel[] = [];

class FakeModel {
  handlers = new Set<MessageHandler>();
  sent: SentMessage[] = [];
  readiness: unknown[] = [];
  onCommand?: (command: LensCommand) => void;
  state = {
    revision: 7,
    nextLabel: "S1",
    currentSelectionId: null,
    selections: [],
    history: [],
  };

  constructor() {
    models.push(this);
  }

  on(eventName: string, handler: MessageHandler): void {
    if (eventName === "msg:custom") this.handlers.add(handler);
  }

  off(eventName: string, handler: MessageHandler): void {
    if (eventName === "msg:custom") this.handlers.delete(handler);
  }

  get(attribute: string): unknown {
    return attribute === "_state" ? this.state : undefined;
  }

  send(message: unknown, _callbacks?: unknown, buffers: ArrayBuffer[] = []): void {
    if (isReadinessEvent(message)) {
      this.readiness.push(message);
      return;
    }
    this.sent.push({ message, buffers });
    if (isLensCommand(message)) this.onCommand?.(message);
  }

  emit(message: unknown, buffers: DataView[] = []): void {
    for (const handler of this.handlers) handler(message, buffers);
  }

  asAnyModel(): AnyModel {
    return this as unknown as AnyModel;
  }
}

afterEach(() => {
  models.length = 0;
  vi.useRealTimers();
});

describe("Lens protocol client", () => {
  test("uses one model listener for requests, events, and output capture", () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);

    client.start();
    client.start();
    client.onSelectionResolved(() => undefined);
    client.onCellAttention(() => undefined);
    client.onOutputCapture(async () => outputCaptureAsset("unused"));

    expect(model.handlers).toHaveLength(1);
    client.dispose();
    expect(model.handlers).toHaveLength(0);
  });

  test("announces output capture readiness for the handler lifetime", () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();

    const release = client.onOutputCapture(async () => outputCaptureAsset("unused"));
    expect(model.readiness).toEqual([readinessEvent("output.capture.ready")]);

    release();
    expect(model.readiness).toEqual([
      readinessEvent("output.capture.ready"),
      readinessEvent("output.capture.unready"),
    ]);
    client.dispose();
  });

  test("returns one output image with exact request and cell correlation", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const command = outputCaptureCommand();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const handler = vi.fn(async (_command: OutputCaptureCommand, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return outputCaptureAsset(command.requestId, bytes);
    });
    client.start();
    client.onOutputCapture(handler);

    model.emit(command);
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(handler).toHaveBeenCalledWith(command, expect.any(AbortSignal));
    expect(model.sent[0]?.message).toEqual({
      protocol: "marimo-lens.response",
      version: 2,
      requestId: "capture-1",
      ok: true,
      revision: 7,
      payload: {
        outputCellId: "cell-1",
        image: outputCaptureAsset(command.requestId).image,
      },
    });
    expect(new Uint8Array(model.sent[0]?.buffers[0] ?? new ArrayBuffer(0))).toEqual(bytes);
    client.dispose();
  });

  test("samples the current state revision after rasterization", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    let finish!: (asset: OutputCaptureAsset) => void;
    client.start();
    client.onOutputCapture(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    model.emit(outputCaptureCommand());
    model.state.revision = 11;
    finish(outputCaptureAsset("capture-1"));
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(model.sent[0]?.message).toMatchObject({ requestId: "capture-1", revision: 11 });
    client.dispose();
  });

  test("reports browser unavailability when no displayed view owns capture", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();

    model.emit(outputCaptureCommand());
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(model.sent[0]).toEqual({
      message: captureFailure("capture-1", "cell-1", "browser_unavailable", expect.any(String)),
      buffers: [],
    });
    client.dispose();
  });

  test("supersedes a pending capture with the newest request", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    let firstSignal: AbortSignal | undefined;
    let finishSecond!: (asset: OutputCaptureAsset) => void;
    const handler = vi.fn((command: OutputCaptureCommand, signal: AbortSignal) => {
      if (command.requestId === "capture-1") {
        firstSignal = signal;
        return new Promise<OutputCaptureAsset>(() => undefined);
      }
      return new Promise<OutputCaptureAsset>((resolve) => {
        finishSecond = resolve;
      });
    });
    client.start();
    client.onOutputCapture(handler);

    model.emit(outputCaptureCommand());
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    model.emit(outputCaptureCommand({ requestId: "capture-2", outputCellId: "cell-2" }));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

    expect(firstSignal?.aborted).toBe(true);
    expect(model.sent).toHaveLength(0);

    finishSecond(outputCaptureAsset("capture-2"));
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));
    expect(model.sent[0]?.message).toMatchObject({ requestId: "capture-2", ok: true });
    client.dispose();
  });

  test("bounds a stalled browser capture and permits the next request", async () => {
    vi.useFakeTimers();
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const handler = vi
      .fn<() => Promise<OutputCaptureAsset>>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(outputCaptureAsset("capture-2"));
    client.start();
    client.onOutputCapture(handler);

    model.emit(outputCaptureCommand());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(model.sent[0]?.message).toEqual(
      captureFailure("capture-1", "cell-1", "capture_timeout", expect.any(String)),
    );

    model.emit(outputCaptureCommand({ requestId: "capture-2", outputCellId: "cell-2" }));
    await vi.runAllTimersAsync();
    expect(model.sent[1]?.message).toMatchObject({ requestId: "capture-2", ok: true });
    client.dispose();
  });

  test("aborts active capture when its handler releases ownership", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    let signal: AbortSignal | undefined;
    client.start();
    const release = client.onOutputCapture((_command, nextSignal) => {
      signal = nextSignal;
      return new Promise(() => undefined);
    });
    model.emit(outputCaptureCommand());
    await vi.waitFor(() => expect(signal).toBeDefined());

    release();

    expect(signal?.aborted).toBe(true);
    expect(model.readiness.at(-1)).toEqual(readinessEvent("output.capture.unready"));
    expect(model.sent).toHaveLength(0);
    client.dispose();
  });

  test("returns stable failures from the capture handler", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();
    client.onOutputCapture(() =>
      Promise.reject(new LensProtocolError("output_unavailable", "Cell output is not visible")),
    );

    model.emit(outputCaptureCommand());
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(model.sent[0]?.message).toEqual(
      captureFailure("capture-1", "cell-1", "output_unavailable", "Cell output is not visible"),
    );
    expect(model.sent[0]?.buffers).toHaveLength(0);
    client.dispose();
  });

  test("rejects binary commands and accepts additive capture fields", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const handler = vi.fn(async () => outputCaptureAsset("capture-1"));
    client.start();
    client.onOutputCapture(handler);

    model.emit(outputCaptureCommand(), [new DataView(new ArrayBuffer(1))]);
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(model.sent[0]?.message).toEqual(
      captureFailure("capture-1", "cell-1", "invalid_command", expect.any(String)),
    );
    expect(handler).not.toHaveBeenCalled();

    model.emit({
      ...outputCaptureCommand(),
      payload: {
        ...outputCaptureCommand().payload,
        trace: "browser",
      },
    });
    await vi.waitFor(() => expect(model.sent).toHaveLength(2));

    expect(handler).toHaveBeenCalledOnce();
    expect(model.sent[1]?.message).toEqual({
      protocol: "marimo-lens.response",
      version: 2,
      requestId: "capture-1",
      ok: true,
      revision: 7,
      payload: {
        outputCellId: "cell-1",
        image: outputCaptureAsset("capture-1").image,
      },
    });
    client.dispose();
  });

  test("rejects image metadata that identifies another request", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();
    client.onOutputCapture(async () => outputCaptureAsset("another-request"));

    model.emit(outputCaptureCommand());
    await vi.waitFor(() => expect(model.sent).toHaveLength(1));

    expect(model.sent[0]?.message).toEqual(
      captureFailure("capture-1", "cell-1", "capture_failed", expect.any(String)),
    );
    client.dispose();
  });

  test("sends selection image bytes after registering the request", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const selection = selectionFixture();
    client.start();
    model.onCommand = (command) => model.emit(success(command, { selection }));

    await client.putSelection(selection, "replace", 3, bytes);

    expect(model.sent[0]?.message).toMatchObject({
      type: "selection.put",
      payload: { expectedRevision: 3, imageAction: "replace" },
    });
    expect(new Uint8Array(model.sent[0]?.buffers[0] ?? new ArrayBuffer(0))).toEqual(bytes);
    client.dispose();
  });

  test("sends exact addressed-history mutations", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();
    model.onCommand = (command) =>
      model.emit(
        success(command, command.type === "selection.reopen" ? { selectionId: "selection-1" } : {}),
      );

    await client.reopenSelection("selection-1", 4, 7);
    await client.clearHistory(8);

    expect(model.sent.map(({ message }) => message)).toMatchObject([
      {
        type: "selection.reopen",
        payload: {
          selectionId: "selection-1",
          resolutionRevision: 4,
          expectedRevision: 7,
        },
      },
      {
        type: "history.clear",
        payload: { expectedRevision: 8 },
      },
    ]);
    client.dispose();
  });

  test("routes durable responses and transient events independently", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const resolved = vi.fn();
    const attended = vi.fn();
    client.start();
    client.onSelectionResolved(resolved);
    client.onCellAttention(attended);

    const request = client.activateSelection("selection-2", 4);
    const command = model.sent[0]?.message;
    if (!isLensCommand(command)) throw new Error("Expected Lens command");
    model.emit({
      protocol: "marimo-lens.event",
      version: 2,
      type: "selection.resolved",
      revision: 4,
      payload: {
        selections: [
          {
            selectionId: "selection-1",
            label: "S1",
            resolutionRevision: 4,
          },
        ],
      },
    });
    model.emit({
      protocol: "marimo-lens.event",
      version: 2,
      type: "cell.reveal",
      revision: 4,
      payload: {
        cellId: "cell-2",
        message: "Updated the chart.",
        durationMs: 8_000,
        displayHint: "compact",
      },
      trace: "python",
    });
    model.emit({
      protocol: "marimo-lens.event",
      version: 2,
      type: "cell.activity.start",
      revision: 4,
      payload: {
        cellId: "cell-3",
        durationMs: 8_000,
        label: "On it",
        message: "Updating the table.",
      },
    });
    model.emit({
      protocol: "marimo-lens.event",
      version: 2,
      type: "cell.activity.stop",
      revision: 4,
      payload: { cellId: "cell-3" },
    });
    model.emit({
      ...success(command, { selectionId: "selection-2", trace: "python" }),
      trace: "python",
    });

    await expect(request).resolves.toMatchObject({ revision: 5 });
    expect(resolved).toHaveBeenCalledOnce();
    expect(attended).toHaveBeenCalledTimes(3);
    expect(attended.mock.calls.map(([event]) => event.type)).toEqual([
      "cell.reveal",
      "cell.activity.start",
      "cell.activity.stop",
    ]);
    expect(attended.mock.calls[0]?.[0]).toEqual({
      protocol: "marimo-lens.event",
      version: 2,
      type: "cell.reveal",
      revision: 4,
      payload: {
        cellId: "cell-2",
        message: "Updated the chart.",
        durationMs: 8_000,
      },
    });
    expect(attended.mock.calls[1]?.[0]).toMatchObject({
      type: "cell.activity.start",
      payload: { cellId: "cell-3", durationMs: 8_000 },
    });
    client.dispose();
  });

  test("reports listener failures after notifying the remaining subscribers", () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const event = {
      protocol: "marimo-lens.event",
      version: 2,
      type: "selection.resolved",
      revision: 4,
      payload: {
        selections: [
          {
            selectionId: "selection-1",
            label: "S1",
            resolutionRevision: 4,
          },
        ],
      },
    };
    const second = vi.fn();
    client.start();
    client.onSelectionResolved(() => {
      throw new Error("listener failed");
    });
    client.onSelectionResolved(second);

    expect(() => model.emit(event)).toThrow("listener failed");
    expect(second).toHaveBeenCalledWith(event);
    client.dispose();
  });

  test("returns the exact durable selection snapshot buffer", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    const source = new Uint8Array([0, 137, 80, 78, 71, 0]);
    client.start();
    model.onCommand = (command) =>
      model.emit(
        success(command, {
          selectionId: "selection-1",
          snapshot: selectionFixture().snapshot,
        }),
        [new DataView(source.buffer, 1, 4)],
      );

    const result = await client.getSnapshot("selection-1");

    expect(result.snapshot.id).toBe("image:selection-1");
    expect(result.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
    client.dispose();
  });

  test("surfaces server errors and validates mutation revisions", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();
    model.onCommand = (command) =>
      model.emit({
        protocol: "marimo-lens.response",
        version: 2,
        requestId: command.requestId,
        ok: false,
        revision: 7,
        payload: {},
        error: { code: "revision_conflict", message: "Refresh canonical state" },
      });

    await expect(client.clearSelections(4)).rejects.toMatchObject({
      code: "revision_conflict",
      revision: 7,
    });

    model.onCommand = (command) =>
      model.emit({ ...success(command, { selectionId: "selection-1" }), revision: 4 });
    await expect(client.activateSelection("selection-1", 4)).rejects.toMatchObject({
      code: "invalid_response",
      revision: 4,
    });
    client.dispose();
  });

  test("times out a request that receives no response", async () => {
    vi.useFakeTimers();
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel(), window);
    client.start();
    const request = client.getSnapshot("selection-1");
    const rejection = expect(request).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    client.dispose();
  });
});

function success(command: LensCommand, payload: Record<string, unknown> = {}) {
  const expectedRevision = Reflect.get(command.payload, "expectedRevision");
  const mutates =
    command.type === "selection.put" ||
    command.type === "selection.activate" ||
    command.type === "selection.delete" ||
    command.type === "selections.clear" ||
    command.type === "selection.reopen" ||
    command.type === "history.clear";
  return {
    protocol: "marimo-lens.response",
    version: 2,
    requestId: command.requestId,
    ok: true,
    revision: typeof expectedRevision === "number" ? expectedRevision + (mutates ? 1 : 0) : 4,
    payload,
  };
}

function outputCaptureCommand(
  overrides: { requestId?: string; outputCellId?: string } = {},
): OutputCaptureCommand {
  return {
    protocol: "marimo-lens.command",
    version: 2,
    requestId: overrides.requestId ?? "capture-1",
    type: "output.capture",
    payload: {
      outputCellId: overrides.outputCellId ?? "cell-1",
    },
  };
}

function outputCaptureAsset(
  requestId: string,
  bytes = new Uint8Array([137, 80, 78, 71]),
): OutputCaptureAsset {
  return {
    image: {
      status: "available",
      id: `image:${requestId}`,
      mediaType: "image/png",
      width: 640,
      height: 480,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-18T10:01:00Z",
    },
    bytes,
  };
}

function captureFailure(
  requestId: string,
  outputCellId: string,
  code: string,
  message: unknown,
): unknown {
  return {
    protocol: "marimo-lens.response",
    version: 2,
    requestId,
    ok: false,
    revision: 7,
    payload: { outputCellId },
    error: { code, message },
  };
}

function readinessEvent(type: "output.capture.ready" | "output.capture.unready"): unknown {
  return { protocol: "marimo-lens.event", version: 2, type, payload: {} };
}

function isReadinessEvent(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message.type === "output.capture.ready" || message.type === "output.capture.unready")
  );
}

function isLensCommand(message: unknown): message is LensCommand {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    message.protocol === "marimo-lens.command"
  );
}
