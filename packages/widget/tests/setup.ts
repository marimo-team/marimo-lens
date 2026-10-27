import { afterEach } from "vite-plus/test";

import { unmountAll } from "./support/render";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(unmountAll);

if (!HTMLElement.prototype.scrollTo) {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.scrollLeft = options.left ?? this.scrollLeft;
    },
  });
}

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

// jsdom gives each iframe a fresh window without the stub above.
const frameDocument = Object.getOwnPropertyDescriptor(
  HTMLIFrameElement.prototype,
  "contentDocument",
)!;
Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
  configurable: true,
  get(this: HTMLIFrameElement) {
    const frame: Document | null = frameDocument.get!.call(this);
    const view = frame?.defaultView;
    if (view && !view.ResizeObserver) view.ResizeObserver = globalThis.ResizeObserver;
    return frame;
  },
});

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
