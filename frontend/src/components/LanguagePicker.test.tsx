import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/me'
import { setUiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'

const router = vi.hoisted(() => ({ navigate: vi.fn(), lang: 'pt' }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useParams: () => ({ lang: router.lang }),
}))
vi.mock('@/api/me', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@/api/me')>()
  return {
    ...original,
    meApi: {
      ...original.meApi,
      setLastLanguage: vi.fn(),
      addLearningLanguage: vi.fn(),
    },
  }
})

import { meApi } from '@/api/me'
import { LanguagePicker } from './LanguagePicker'

const baseUser = {
  id: 'user-1',
  email: 'learner@example.com',
  role: 'learner',
  display_name: 'Learner',
  ui_language_code: 'ru',
  learning_languages: ['pt'],
  last_learning_language_code: 'pt',
  needs_onboarding: false,
  onboarded_at: '2026-09-11T00:00:00Z',
  preferred_translation_language_code: 'ru',
  daily_goal_minutes: 15,
  daily_goal_reviews: 20,
} satisfies MeResponse

function show(user: MeResponse = baseUser) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useUserStore.getState().setUser(user)
  const result = render(
    <QueryClientProvider client={queryClient}>
      <LanguagePicker />
    </QueryClientProvider>,
  )
  return {
    ...result,
    queryClient,
    rerenderPicker: () =>
      result.rerender(
        <QueryClientProvider client={queryClient}>
          <LanguagePicker />
        </QueryClientProvider>,
      ),
  }
}

async function openAddDialog() {
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: /^(Язык материала|Material language):/ }),
  )
  await user.click(await screen.findByRole('menuitem', { name: /^(Добавить язык|Add language)$/ }))
  return screen.findByRole('dialog', { name: /^(Добавить язык|Add language)$/ })
}

beforeEach(() => {
  vi.clearAllMocks()
  router.lang = 'pt'
  setUiLanguage('ru')
  useUserStore.getState().reset()
})

afterEach(() => {
  act(() => {
    useUserStore.getState().reset()
    setUiLanguage('ru')
  })
})

describe('LanguagePicker add-language flow', () => {
  it('offers the ten localized flagged choices and disables an existing language', async () => {
    setUiLanguage('en')
    show({ ...baseUser, ui_language_code: 'en' })

    expect(screen.getByRole('button', { name: 'Material language: Portuguese' })).toBeInTheDocument()
    const dialog = await openAddDialog()
    const choices = within(dialog).getAllByRole('radio')
    expect(choices).toHaveLength(10)
    expect(within(dialog).getByRole('radio', { name: 'Chinese (Simplified)' })).toBeEnabled()
    expect(within(dialog).getByRole('radio', { name: 'Portuguese' })).toBeDisabled()
    expect(within(dialog).getByText('🇨🇳')).toHaveAttribute('aria-hidden', 'true')
    expect(within(dialog).getByText('🇵🇹')).toHaveAttribute('aria-hidden', 'true')
  })

  it('cancels without changing the profile or sending a request', async () => {
    const user = userEvent.setup()
    show()
    const dialog = await openAddDialog()

    await user.click(within(dialog).getByRole('radio', { name: 'Китайский (упрощённый)' }))
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))

    expect(screen.queryByRole('dialog', { name: 'Добавить язык' })).not.toBeInTheDocument()
    expect(meApi.addLearningLanguage).not.toHaveBeenCalled()
    expect(useUserStore.getState().user).toEqual(baseUser)
  })

  it('keeps the profile and selection available after a rejected request', async () => {
    const user = userEvent.setup()
    vi.mocked(meApi.addLearningLanguage).mockRejectedValue(new Error('offline'))
    show()
    const dialog = await openAddDialog()

    const chinese = within(dialog).getByRole('radio', { name: 'Китайский (упрощённый)' })
    await user.click(chinese)
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Не удалось выполнить запрос. Попробуйте ещё раз.',
    )
    expect(chinese).toBeChecked()
    expect(chinese).toBeEnabled()
    expect(useUserStore.getState().user).toEqual(baseUser)
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('supports opening, skipping a disabled radio and cancelling with the keyboard', async () => {
    const user = userEvent.setup()
    show()

    await user.tab()
    const trigger = screen.getByRole('button', { name: 'Язык материала: Португальский' })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}{End}{Enter}')

    const dialog = await screen.findByRole('dialog', { name: 'Добавить язык' })
    const english = within(dialog).getByRole('radio', { name: 'Английский' })
    const russian = within(dialog).getByRole('radio', { name: 'Русский' })
    const portuguese = within(dialog).getByRole('radio', { name: 'Португальский' })
    const spanish = within(dialog).getByRole('radio', { name: 'Испанский' })
    expect(english).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(russian).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(portuguese).toBeDisabled()
    expect(spanish).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Добавить язык' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(meApi.addLearningLanguage).not.toHaveBeenCalled()
  })

  it('blocks repeat submission, then updates the store, me cache and library route', async () => {
    const user = userEvent.setup()
    let resolveRequest!: (value: MeResponse) => void
    const updated = {
      ...baseUser,
      learning_languages: ['pt', 'zh-Hans'],
      last_learning_language_code: 'zh-Hans',
    } satisfies MeResponse
    vi.mocked(meApi.addLearningLanguage).mockReturnValue(
      new Promise<MeResponse>((resolve) => {
        resolveRequest = resolve
      }),
    )
    const { queryClient, rerenderPicker } = show()
    const dialog = await openAddDialog()

    await user.click(within(dialog).getByRole('radio', { name: 'Китайский (упрощённый)' }))
    const submit = within(dialog).getByRole('button', { name: 'Добавить' })
    await user.click(submit)
    expect(submit).toBeDisabled()
    expect(meApi.addLearningLanguage).toHaveBeenCalledOnce()
    expect(meApi.addLearningLanguage).toHaveBeenCalledWith('zh-Hans')
    fireEvent.click(submit)
    expect(meApi.addLearningLanguage).toHaveBeenCalledOnce()

    await act(async () => resolveRequest(updated))

    await waitFor(() => expect(useUserStore.getState().user).toEqual(updated))
    expect(queryClient.getQueryData(['me'])).toEqual(updated)
    expect(router.navigate).toHaveBeenCalledWith({
      to: '/learn/$lang/library',
      params: { lang: 'zh-Hans' },
    })
    router.lang = 'zh-Hans'
    rerenderPicker()
    expect(
      screen.getByRole('button', { name: 'Язык материала: Китайский (упрощённый)' }),
    ).toBeInTheDocument()
  })

  it('shows an all-added state with no selectable option', async () => {
    show({
      ...baseUser,
      learning_languages: ['en', 'ru', 'pt', 'es', 'fr', 'de', 'zh-Hans', 'ja', 'ar', 'hi'],
    })

    const dialog = await openAddDialog()
    expect(within(dialog).getByText('Все доступные языки уже добавлены.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('radio')).toHaveLength(10)
    expect(
      within(dialog)
        .getAllByRole('radio')
        .every((choice) => choice.hasAttribute('disabled')),
    ).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled()
  })
})
