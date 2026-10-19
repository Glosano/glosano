import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ Outlet: () => null }))

import { getUiLanguage, setUiLanguage } from '@/lib/i18n'

import { RootLayout } from './__root'

afterEach(() => {
  act(() => setUiLanguage('ru'))
  localStorage.clear()
})

describe('RootLayout', () => {
  it('sets the document language without storing it as the device choice', () => {
    localStorage.clear()
    render(<RootLayout />)
    expect(document.documentElement.lang).toBe(getUiLanguage())
    // The active language at boot may come from the browser; that is not an explicit choice.
    expect(localStorage.getItem('glosano.ui-language')).toBeNull()
  })

  it('follows a language switch in the document language', async () => {
    render(<RootLayout />)
    await act(async () => {
      await setUiLanguage('zh-Hans')
    })
    expect(document.documentElement.lang).toBe('zh-Hans')
  })
})
