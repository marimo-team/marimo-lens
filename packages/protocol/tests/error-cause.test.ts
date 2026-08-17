import { describe, expect, test } from "vite-plus/test";

import { isAbortCause, parseErrorCause } from "../src/index";

describe("error causes", () => {
  test("decodes error name and message across constructor realms", () => {
    expect(parseErrorCause({ name: "EncodingError", message: "Raster failed" })).toEqual({
      name: "EncodingError",
      message: "Raster failed",
    });
  });

  test("recognizes structural AbortError causes", () => {
    expect(isAbortCause(new DOMException("Canceled", "AbortError"))).toBe(true);
    expect(isAbortCause({ name: "AbortError", message: "Canceled elsewhere" })).toBe(true);
    expect(isAbortCause({ name: "EncodingError", message: "Raster failed" })).toBe(false);
    expect(isAbortCause(null)).toBe(false);
  });
});
