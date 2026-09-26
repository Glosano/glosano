import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './copyText'

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

describe('copyText', () => {
  it('uses the async clipboard when the page may use it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await expect(copyText('Olá')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('Olá')
  })

  it('falls back to a hidden textarea where the clipboard API is missing, as on plain HTTP', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await expect(copyText('Olá')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
