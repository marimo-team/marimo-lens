import { describe, expect, test, vi } from "vite-plus/test";

import { isEditableKeyboardEvent } from "@/lib/editable-event";

describe("isEditableKeyboardEvent", () => {
  test("detects editable controls inside an open shadow-root composed path", () => {
    document.body.innerHTML = "<shadow-host></shadow-host>";
    const host = document.querySelector("shadow-host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<input value="typing" />`;
    const input = root.querySelector("input")!;
    const event = new KeyboardEvent("keydown", { key: "x" });
    vi.spyOn(event, "composedPath").mockReturnValue([input, host, document.body, document]);
    Object.defineProperty(event, "target", { value: host });

    expect(isEditableKeyboardEvent(event)).toBe(true);
  });

  test("detects editor role ancestors from the composed path", () => {
    document.body.innerHTML = `<div role="textbox"><span data-cursor></span></div>`;
    const cursor = document.querySelector("[data-cursor]")!;
    const event = new KeyboardEvent("keydown", { key: "c" });
    vi.spyOn(event, "composedPath").mockReturnValue([cursor, document.body, document]);

    expect(isEditableKeyboardEvent(event)).toBe(true);
  });

  test("treats focused buttons and handled key events as shortcut-blocking", () => {
    document.body.innerHTML = `<button type="button">Copy</button>`;
    const button = document.querySelector("button")!;
    const buttonEvent = new KeyboardEvent("keydown", { key: "c" });
    vi.spyOn(buttonEvent, "composedPath").mockReturnValue([button, document.body, document]);

    const handledEvent = new KeyboardEvent("keydown", { key: "r" });
    Object.defineProperty(handledEvent, "defaultPrevented", { value: true });

    expect(isEditableKeyboardEvent(buttonEvent)).toBe(true);
    expect(isEditableKeyboardEvent(handledEvent)).toBe(true);
  });
});
