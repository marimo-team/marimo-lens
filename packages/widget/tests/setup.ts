Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

if (!globalThis.matchMedia) {
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

if (!HTMLDialogElement.prototype.showModal) {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
}

if (!globalThis.CSS) Object.assign(globalThis, { CSS: {} });
if (!CSS.escape) {
  Object.assign(CSS, { escape: (value: string) => value.replaceAll('"', '\\"') });
}
