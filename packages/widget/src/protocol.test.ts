import type { AnyModel } from "@anywidget/types";

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensCommand } from "@/contracts";

import { LensProtocolClient, LensProtocolError } from "@/protocol";
import { selectionFixture } from "@/test-fixtures";

type MessageHandler = (message: unknown, buffers: DataView[]) => void;

class FakeModel {
  handlers = new Set<MessageHandler>();
  sent: Array<{ command: LensCommand; buffers: ArrayBuffer[] }> = [];
  onSend?: (command: LensCommand) => void;

  on(eventName: string, handler: MessageHandler) {
    if (eventName === "msg:custom") this.handlers.add(handler);
  }

  off(eventName: string, handler: MessageHandler) {
    if (eventName === "msg:custom") this.handlers.delete(handler);
  }

  send(command: LensCommand, _callbacks?: unknown, buffers: ArrayBuffer[] = []) {
    this.sent.push({ command, buffers });
    this.onSend?.(command);
  }

  emit(message: unknown) {
    for (const handler of this.handlers) handler(message, []);
  }

  asAnyModel(): AnyModel {
    return this as unknown as AnyModel;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

function success(command: LensCommand, payload: Record<string, unknown> = {}) {
  return {
    protocol: "marimo-lens.response",
    version: 1,
    requestId: command.requestId,
    ok: true,
    revision: 4,
    payload,
  };
}

describe("Lens command protocol", () => {
  test("exports standalone text through the context command", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    await expect(client.exportContext()).rejects.toMatchObject({ code: "client_disposed" });

    client.start();
    model.onSend = (command) => model.emit(success(command, { text: "Use selection S1" }));
    await expect(client.exportContext()).resolves.toBe("Use selection S1");
    expect(model.sent[0]?.command).toMatchObject({ version: 1, type: "context.export" });
    client.dispose();
  });

  test("registers the request before sending PNG bytes", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    client.start();
    model.onSend = (command) => model.emit(success(command));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const selection = selectionFixture({
      snapshot: {
        status: "available",
        id: "image:selection-1",
        mediaType: "image/png",
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
        capturedAt: "2026-07-14T10:01:00Z",
      },
    });

    await client.putSelection(selection, "replace", 3, bytes);

    expect(model.sent[0]?.command).toMatchObject({
      type: "selection.put",
      payload: { expectedRevision: 3, imageAction: "replace" },
    });
    expect(new Uint8Array(model.sent[0]?.buffers[0] ?? new ArrayBuffer(0))).toEqual(bytes);
    client.dispose();
  });

  test("correlates responses while ignoring other custom messages", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    client.start();
    const request = client.exportContext();
    const command = model.sent[0]?.command;
    expect(command).toBeDefined();
    model.emit({ protocol: "another-widget.response", requestId: command?.requestId });
    model.emit(success(command!, { text: "Selection S1" }));

    await expect(request).resolves.toBe("Selection S1");
    client.dispose();
  });

  test("surfaces strict server errors with their revision", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    client.start();
    model.onSend = (command) =>
      model.emit({
        protocol: "marimo-lens.response",
        version: 1,
        requestId: command.requestId,
        ok: false,
        revision: 7,
        payload: {},
        error: { code: "revision_conflict", message: "Refresh the canonical state" },
      });

    const error = await client
      .putSelection(selectionFixture({ snapshot: { status: "pending" } }), "clear", 4)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(LensProtocolError);
    expect(error).toMatchObject({ code: "revision_conflict", revision: 7 });
    client.dispose();
  });

  test("sends revisions for activate, delete, and clear", async () => {
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    client.start();
    model.onSend = (command) => model.emit(success(command));

    await client.activateSelection("selection-1", 7);
    await client.deleteSelection("selection-1", 8);
    await client.clearSelections(9);

    expect(model.sent.map(({ command }) => command)).toMatchObject([
      { type: "selection.activate", payload: { selectionId: "selection-1", expectedRevision: 7 } },
      { type: "selection.delete", payload: { selectionId: "selection-1", expectedRevision: 8 } },
      { type: "selections.clear", payload: { expectedRevision: 9 } },
    ]);
    client.dispose();
  });

  test("rejects a request that receives no response", async () => {
    vi.useFakeTimers();
    const model = new FakeModel();
    const client = new LensProtocolClient(model.asAnyModel());
    client.start();
    const request = client.exportContext();
    const rejection = expect(request).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    client.dispose();
  });
});
