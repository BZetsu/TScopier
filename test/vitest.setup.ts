/** Minimal sessionStorage for Vitest (node environment has no browser globals). */
const store = new Map<string, string>()

const sessionStorageMock: Storage = {
  getItem(key: string) {
    return store.get(key) ?? null
  },
  setItem(key: string, value: string) {
    store.set(key, value)
  },
  removeItem(key: string) {
    store.delete(key)
  },
  clear() {
    store.clear()
  },
  key(index: number) {
    return [...store.keys()][index] ?? null
  },
  get length() {
    return store.size
  },
}

Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
})
