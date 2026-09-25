import { afterEach, describe, expect, it, vi } from 'vitest'

import { randomId } from './randomId'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a UUID v4 when crypto.randomUUID is available', () => {
    expect(randomId()).toMatch(UUID_V4)
  })

  // Browsers expose crypto.randomUUID only in secure contexts (HTTPS or
  // localhost); a self-hosted instance opened at http://<lan-ip> has
  // getRandomValues but no randomUUID.
  it('returns unique UUID v4 values when crypto.randomUUID is unavailable', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })

    const ids = new Set(Array.from({ length: 100 }, () => randomId()))

    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
