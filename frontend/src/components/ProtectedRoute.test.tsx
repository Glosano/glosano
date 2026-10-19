import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/api/me', () => ({ meApi: { get: vi.fn() } }))

import { meApi, type MeResponse } from '@/api/me'
import {
  __resetCatalogsForTests,
  __setCatalogLoaderForTests,
  type Catalog,
  getUiLanguage,
  loadCatalog,
  setUiLanguage,
  useTranslation,
} from '@/lib/i18n'
import { UI_LANGUAGE_CODES } from '@/lib/uiLanguages'
import { useUserStore } from '@/stores/userStore'

import { ProtectedRoute } from './ProtectedRoute'

const profile = {
  id: 'u1',
  email: 'learner@example.com',
  role: 'learner',
  display_name: 'Learner',
  ui_language_code: 'ja',
  learning_languages: ['pt'],
  last_learning_language_code: 'pt',
  needs_onboarding: false,
  onboarded_at: '2026-09-11T00:00:00Z',
  native_language_code: 'ja',
  daily_goal_minutes: 15,
  daily_goal_reviews: 500,
} satisfies MeResponse

afterEach(async () => {
  useUserStore.getState().reset()
  __resetCatalogsForTests()
  await Promise.all(UI_LANGUAGE_CODES.map(loadCatalog))
  await act(async () => {
    await setUiLanguage('ru')
  })
  vi.clearAllMocks()
})

const seen: string[] = []
function Page() {
  const t = useTranslation()
  const text = t('Settings')
  seen.push(text)
  return <p>{text}</p>
}

function show() {
  seen.length = 0
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProtectedRoute>
        <Page />
      </ProtectedRoute>
    </QueryClientProvider>,
  )
}

async function forgetCatalogsExceptRussian() {
  __resetCatalogsForTests()
  await Promise.all([loadCatalog('en'), loadCatalog('ru')])
}

describe('ProtectedRoute', () => {
  it('renders the page only once the profile language is in, so the device language never shows', async () => {
    await forgetCatalogsExceptRussian()
    let finish!: (catalog: Catalog) => void
    __setCatalogLoaderForTests(
      () =>
        new Promise((resolve) => {
          finish = (catalog) => resolve([{ default: catalog }])
        }),
    )
    vi.mocked(meApi.get).mockResolvedValue({ ...profile })
    show()

    await waitFor(() => expect(useUserStore.getState().user?.id).toBe('u1'))
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    expect(seen).toEqual([])

    await act(async () => {
      finish({ Settings: '設定' })
    })
    expect(await screen.findByText('設定')).toBeInTheDocument()
    expect(getUiLanguage()).toBe('ja')
    expect(seen.every((text) => text === '設定')).toBe(true)
  })

  it('still renders the page, in the active language, when the profile language fails to load', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await forgetCatalogsExceptRussian()
      __setCatalogLoaderForTests(() => Promise.reject(new Error('offline')))
      vi.mocked(meApi.get).mockResolvedValue({ ...profile })
      show()

      expect(await screen.findByText('Настройки')).toBeInTheDocument()
      expect(getUiLanguage()).toBe('ru')
    } finally {
      logged.mockRestore()
    }
  })
})
