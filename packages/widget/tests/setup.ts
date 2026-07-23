Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

if (typeof globalThis.matchMedia !== "function") {
  Object.assign(globalThis, {
    matchMedia: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
}

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}

if (typeof CSS === "undefined") Object.assign(globalThis, { CSS: {} });
if (typeof CSS.escape !== "function") {
  Object.assign(CSS, { escape: (value: string) => value.replaceAll('"', '\\"') });
}
