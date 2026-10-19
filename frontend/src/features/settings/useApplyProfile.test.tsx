import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/me'
import {
  __resetCatalogsForTests,
  __setCatalogLoaderForTests,
  getUiLanguage,
  loadCatalog,
  setUiLanguage,
  type Catalog,
} from '@/lib/i18n'
import { UI_LANGUAGE_CODES } from '@/lib/uiLanguages'
import { useUserStore } from '@/stores/userStore'

import { useApplyProfile } from './useApplyProfile'

const profile = {
  id: 'u1',
  email: 'learner@example.com',
  role: 'learner',
  display_name: 'Learner',
  ui_language_code: 'ru',
  learning_languages: ['pt'],
  last_learning_language_code: 'pt',
  needs_onboarding: false,
  onboarded_at: '2026-09-11T00:00:00Z',
  native_language_code: 'ru',
  daily_goal_minutes: 15,
  daily_goal_reviews: 500,
} satisfies MeResponse

afterEach(async () => {
  useUserStore.getState().reset()
  __resetCatalogsForTests()
  await Promise.all(UI_LANGUAGE_CODES.map(loadCatalog))
  await setUiLanguage('ru')
})

describe('useApplyProfile', () => {
  it('switches the language once and refetches only after its catalog has loaded', async () => {
    await setUiLanguage('en')
    __resetCatalogsForTests()
    await loadCatalog('en')
    let finishLoading!: (catalog: Catalog) => void
    const loader = vi.fn(
      () =>
        new Promise<Record<string, Catalog>[]>((resolve) => {
          finishLoading = (catalog) => resolve([{ default: catalog }])
        }),
    )
    __setCatalogLoaderForTests(loader)
    useUserStore.getState().setUser({ ...profile, ui_language_code: 'en' })

    const cache = new QueryClient()
    cache.setQueryData(['vocabulary'], ['stale in English'])
    const { result } = renderHook(() => useApplyProfile(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    })

    let applied!: Promise<void>
    act(() => {
      applied = result.current({ ...profile, ui_language_code: 'ru' })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(loader).toHaveBeenCalledTimes(1)
    expect(getUiLanguage()).toBe('en')
    expect(cache.getQueryData(['vocabulary'])).toEqual(['stale in English'])

    await act(async () => {
      finishLoading({ Settings: 'Настройки' })
      await applied
    })
    expect(loader).toHaveBeenCalledTimes(1)
    expect(getUiLanguage()).toBe('ru')
    expect(cache.getQueryData(['vocabulary'])).toBeUndefined()
  })

  it('still refreshes the caches when the new language fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await setUiLanguage('en')
    __resetCatalogsForTests()
    await loadCatalog('en')
    __setCatalogLoaderForTests(() => Promise.reject(new Error('offline')))
    useUserStore.getState().setUser({ ...profile, ui_language_code: 'en' })

    const cache = new QueryClient()
    cache.setQueryData(['vocabulary'], ['stale'])
    const { result } = renderHook(() => useApplyProfile(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    })

    await act(async () => {
      await result.current({ ...profile, ui_language_code: 'ru' })
    })
    expect(getUiLanguage()).toBe('en')
    expect(cache.getQueryData(['me'])).toEqual({ ...profile, ui_language_code: 'ru' })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
