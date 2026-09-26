import { vi } from 'vitest'

/** Installs a `window.matchMedia` stub where only `matching` queries match. */
export function mockMediaQueries(matching: string[]): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/** Removes the stub so jsdom goes back to having no `matchMedia`. */
export function clearMediaQueries(): void {
  Reflect.deleteProperty(window, 'matchMedia')
}
