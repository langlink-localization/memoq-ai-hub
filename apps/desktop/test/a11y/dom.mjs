import { JSDOM } from 'jsdom';

const DOM_GLOBALS = [
  'navigator',
  'HTMLElement',
  'HTMLAnchorElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'SVGElement',
  'DocumentFragment',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'getSelection',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CustomEvent',
  'Event',
  'FocusEvent',
  'InputEvent',
  'KeyboardEvent',
  'MouseEvent',
  'PointerEvent'
];

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in window) {
      Object.defineProperty(globalThis, key, {
        value: window[key],
        configurable: true,
        writable: true
      });
    }
  }
  return dom;
}
