import fs from 'node:fs/promises';

export function installBrowserShims() {
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; },
    key(index) { return [...store.keys()][index] ?? null; },
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  globalThis.fetch = async (path) => ({
    async json() {
      const filePath = String(path).split(/[?#]/, 1)[0];
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    },
  });
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
  const fakeClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const fakeElement = {
    classList: fakeClassList,
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  globalThis.document = globalThis.document || {};
  globalThis.document.querySelectorAll = globalThis.document.querySelectorAll || (() => []);
  globalThis.document.querySelector = globalThis.document.querySelector || (() => null);
  globalThis.document.getElementById = globalThis.document.getElementById || (() => fakeElement);
  globalThis.document.createElement = globalThis.document.createElement || (() => ({ ...fakeElement, classList: { ...fakeClassList } }));
  globalThis.document.body = globalThis.document.body || fakeElement;
}

export function makeSeededRandom(seed = 12345) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function withSeededRandom(seed, fn) {
  const originalRandom = Math.random;
  Math.random = makeSeededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}
