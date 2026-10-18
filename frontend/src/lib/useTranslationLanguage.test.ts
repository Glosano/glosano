import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/me'
import { setUiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'

import { useTranslationLanguage } from './useTranslationLanguage'

afterEach(() => {
  act(() => {
    useUserStore.getState().reset()
    setUiLanguage('ru')
  })
})

describe('useTranslationLanguage', () => {
  it('targets the native language, not the interface language', () => {
    setUiLanguage('ru')
    useUserStore.setState({
      user: { ui_language_code: 'ru', native_language_code: 'uk' } as MeResponse,
    })
    const { result } = renderHook(() => useTranslationLanguage())
    expect(result.current).toBe('uk')
    act(() => setUiLanguage('en'))
    expect(result.current).toBe('uk')
  })

  it('falls back to the interface language while the user is not loaded', () => {
    setUiLanguage('en')
    const { result } = renderHook(() => useTranslationLanguage())
    expect(result.current).toBe('en')
  })
})
