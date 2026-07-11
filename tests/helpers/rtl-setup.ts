import '@testing-library/jest-dom';
import { cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 3000 });

// Several primitives (Modal, PageHeader, …) call `useRouter()`. Outside a
// Next app there is no router context, and next/navigation throws
// "invariant expected app router to be mounted". Provide a stub so the
// primitives can be rendered in isolation.
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// jsdom implements neither of these; Radix and the virtualized table both
// probe for them on mount.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
}

if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no Pointer Capture API. `vaul` (the drawer behind Modal /
// Sheet / ConfirmDialog) calls setPointerCapture on press, which throws
// "not a function" and swallows the click before onConfirm ever fires.
for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
  if (!Element.prototype[method]) {
    Element.prototype[method] = function noop() {};
  }
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
}

// Radix's Presence/positioning code paths call this too.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function noop() {};
}

// vaul's getTranslate() does `style.transform || style.webkitTransform ||
// style.mozTransform` then calls `.match()` on the result. jsdom reports
// transform as '' and the vendor-prefixed variants as undefined, so the
// chain yields undefined and the drawer throws on pointer-up — swallowing
// the click. Report a real 'none' so the parse path is exercised.
const realGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
  const style = realGetComputedStyle(el, pseudo ?? undefined);
  if (!style.transform) {
    Object.defineProperty(style, 'transform', { value: 'none', configurable: true });
  }
  return style;
}) as typeof window.getComputedStyle;

afterEach(() => {
  cleanup();
});
