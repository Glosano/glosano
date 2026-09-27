import { browser } from 'wxt/browser'

// Firefox ignores match patterns that contain a port, so a granted
// `http://localhost:8000/*` still leaves requests subject to CORS there.
// A port-less pattern covers every port of the host in both browsers.
export function hostPattern(origin: string): string {
  const { protocol, hostname } = new URL(origin)
  return `${protocol}//${hostname}/*`
}

export function hasHostPermission(origin: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [hostPattern(origin)] })
}

// Must be called directly from a click handler: Firefox drops the request after an await.
export function requestHostPermission(origin: string): Promise<boolean> {
  return browser.permissions.request({ origins: [hostPattern(origin)] })
}
