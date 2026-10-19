import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Radix Select scrolls the highlighted option; jsdom has no layout API.
Element.prototype.scrollIntoView = vi.fn()

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/api/me', () => ({ meApi: { onboarding: vi.fn(), get: vi.fn() } }))

import { ApiError } from '@/api/client'
import { meApi, type MeResponse } from '@/api/me'
import { setUiLanguage } from '@/lib/i18n'
import { UI_LANGUAGE_CODES, uiLanguageEndonym } from '@/lib/uiLanguages'
import { useUserStore } from '@/stores/userStore'
import { OnboardingForm } from './OnboardingForm'
import { languageName } from '@/lib/languages'

const langRu = (code: string) => languageName(code, 'ru')
const langEn = (code: string) => languageName(code, 'en')

const newUser = {
  id: 'u',
  email: 'user@example.com',
  role: 'learner' as const,
  display_name: 'Alex',
  ui_language_code: 'ru',
  learning_languages: [],
  last_learning_language_code: null,
  needs_onboarding: true,
  onboarded_at: null,
  native_language_code: null,
  preferred_translation_language_code: 'ru',
  daily_goal_minutes: 15,
  daily_goal_reviews: 20,
} satisfies MeResponse

const migratedUser = {
  ...newUser,
  learning_languages: ['ru', 'pt'],
  last_learning_language_code: 'pt',
  onboarded_at: '2026-09-11T00:00:00Z',
} satisfies MeResponse

/** Renders like a cold reload of /onboarding: empty store, profile comes from /me. */
async function show(profile: MeResponse = newUser) {
  vi.mocked(meApi.get).mockResolvedValueOnce(profile)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingForm />
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: /^(Готово|Done)$/ })
  return queryClient
}

beforeEach(() => {
  vi.clearAllMocks()
  useUserStore.setState({ user: null })
  setUiLanguage('ru')
})
afterEach(() => {
  act(() => {
    useUserStore.setState({ user: null })
    setUiLanguage('ru')
  })
})

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OnboardingForm localization', () => {
  it('offers all ten learning languages with localized names and decorative flags', async () => {
    await show({ ...newUser, ui_language_code: 'en' })

    expect(screen.getAllByRole('checkbox')).toHaveLength(10)
    expect(screen.getByRole('checkbox', { name: langEn('zh-Hans') })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: langEn('ar') })).toBeInTheDocument()
    expect(screen.getByText('🇨🇳')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('🇸🇦')).toHaveAttribute('aria-hidden', 'true')
  })

  it('previews the selected interface language and sends the native language', async () => {
    const user = userEvent.setup()
    const me = {
      ...newUser,
      ui_language_code: 'en',
      learning_languages: ['pt'],
      last_learning_language_code: 'pt',
      needs_onboarding: false,
      onboarded_at: '2026-09-11T00:00:00Z',
      native_language_code: 'en',
      preferred_translation_language_code: 'en',
    } satisfies MeResponse
    vi.mocked(meApi.onboarding).mockResolvedValue({ ok: true, redirect: '/learn/pt/library' })
    const queryClient = await show()
    vi.mocked(meApi.get).mockResolvedValue(me)
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    const selector = screen.getByRole('combobox', { name: 'Язык интерфейса' })
    selector.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('option', { name: langEn('en') }))
    expect(screen.getByRole('heading', { name: 'Welcome to Glosano' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: langEn('pt') }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(meApi.onboarding).toHaveBeenCalledWith({
        ui_language: 'en',
        learning_languages: ['pt'],
        native_language: 'en',
      }),
    )
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/learn/$lang/library', params: { lang: 'pt' } }),
    )
    expect(queryClient.getQueryData(['me'])).toEqual(me)
  })

  it('lists every enabled interface language under its own name', async () => {
    const user = userEvent.setup()
    await show()
    screen.getByRole('combobox', { name: 'Язык интерфейса' }).focus()
    await user.keyboard('{ArrowDown}')

    const options = await screen.findAllByRole('option')
    expect(options.slice(0, UI_LANGUAGE_CODES.length).map((option) => option.textContent)).toEqual(
      UI_LANGUAGE_CODES.map((code) => uiLanguageEndonym(code)),
    )
  })

  it("starts from the profile's interface language and defaults the native one to it", async () => {
    await show({ ...newUser, ui_language_code: 'en' })

    expect(screen.getByRole('combobox', { name: 'Interface language' })).toHaveTextContent(
      langEn('en'),
    )
    expect(screen.getByRole('combobox', { name: 'Native language' })).toHaveTextContent(langEn('en'))
    expect(screen.getByRole('checkbox', { name: langEn('en') })).toBeDisabled()
  })

  it('starts from a non-English, non-Russian profile interface language', async () => {
    vi.mocked(meApi.get).mockResolvedValueOnce({ ...newUser, ui_language_code: 'de' })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingForm />
      </QueryClientProvider>,
    )
    await screen.findByRole('button', { name: 'Fertig' })

    expect(
      screen.getByRole('combobox', { name: 'Sprache der Benutzeroberfläche' }),
    ).toHaveTextContent('Deutsch')
    expect(screen.getByRole('combobox', { name: 'Muttersprache' })).toHaveTextContent('Deutsch')
    expect(screen.getByRole('checkbox', { name: 'Deutsch' })).toBeDisabled()
  })

  it('updates an existing validation error when the UI language changes', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.getByText('Выберите хотя бы один язык')).toBeInTheDocument()
    act(() => setUiLanguage('en'))
    expect(screen.getByText('Select at least one language')).toBeInTheDocument()
    expect(meApi.onboarding).not.toHaveBeenCalled()
  })
})

describe('OnboardingForm profile loading', () => {
  it('sends an unauthenticated visitor to the login page', async () => {
    vi.mocked(meApi.get).mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingForm />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }))
    expect(screen.queryByRole('button', { name: 'Готово' })).not.toBeInTheDocument()
  })
})

async function chooseNative(name: string) {
  const user = userEvent.setup()
  const selector = screen.getByRole('combobox', { name: 'Родной язык' })
  selector.focus()
  await user.keyboard('{ArrowDown}')
  await user.click(await screen.findByRole('option', { name }))
}

describe('OnboardingForm native language', () => {
  it('requires a native language that defaults to the interface language', async () => {
    await show()

    const native = screen.getByRole('combobox', { name: 'Родной язык' })
    expect(native).toHaveAttribute('aria-required', 'true')
    expect(native).toHaveTextContent(langRu('ru'))
    expect(screen.getByRole('checkbox', { name: langRu('ru') })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: langRu('pt') })).toBeEnabled()
  })

  it('offers all fifteen catalog languages as native', async () => {
    const user = userEvent.setup()
    await show()
    screen.getByRole('combobox', { name: 'Родной язык' }).focus()
    await user.keyboard('{ArrowDown}')

    expect(await screen.findAllByRole('option')).toHaveLength(15)
    expect(screen.getByRole('option', { name: langRu('uk') })).toBeInTheDocument()
  })

  it('disables and unchecks the learning language chosen as native, with a note', async () => {
    const user = userEvent.setup()
    await show()
    await user.click(screen.getByRole('checkbox', { name: langRu('pt') }))
    expect(screen.getByRole('checkbox', { name: langRu('pt') })).toBeChecked()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await chooseNative(langRu('pt'))

    const portuguese = screen.getByRole('checkbox', { name: langRu('pt') })
    expect(portuguese).not.toBeChecked()
    expect(portuguese).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: langRu('ru') })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      `${langRu('pt')} убран из изучаемых: родной язык нельзя изучать. Уроки и словарь сохранены.`,
    )
  })

  it('explains why the native language is disabled among learning languages', async () => {
    await show()
    const note = 'Это ваш родной язык — смените его выше'
    expect(screen.getByRole('checkbox', { name: langRu('ru') })).toHaveAccessibleDescription(note)
    expect(
      screen.getByRole('checkbox', { name: langRu('pt') }),
    ).not.toHaveAccessibleDescription()

    await chooseNative(langRu('pt'))

    expect(screen.getByRole('checkbox', { name: langRu('pt') })).toHaveAccessibleDescription(
      note,
    )
    expect(screen.getByRole('checkbox', { name: langRu('ru') })).not.toHaveAccessibleDescription()
  })

  it('submits the chosen native language', async () => {
    const user = userEvent.setup()
    vi.mocked(meApi.onboarding).mockResolvedValue({ ok: true, redirect: '/learn/es/library' })
    await show()
    vi.mocked(meApi.get).mockResolvedValue({ ...migratedUser, needs_onboarding: false })
    await chooseNative(langRu('uk'))
    await user.click(screen.getByRole('checkbox', { name: langRu('es') }))
    await user.click(screen.getByRole('button', { name: 'Готово' }))

    await waitFor(() =>
      expect(meApi.onboarding).toHaveBeenCalledWith({
        ui_language: 'ru',
        learning_languages: ['es'],
        native_language: 'uk',
      }),
    )
    expect(screen.queryByText(/убран из изучаемых/)).not.toBeInTheDocument()
  })

  it('keeps every learning language of a migrated user after a cold reload', async () => {
    const user = userEvent.setup()
    vi.mocked(meApi.onboarding).mockResolvedValue({ ok: true, redirect: '/learn/pt/library' })
    await show({ ...migratedUser, learning_languages: ['ru', 'pt', 'es'] })
    vi.mocked(meApi.get).mockResolvedValue({
      ...migratedUser,
      learning_languages: ['ru', 'pt', 'es'],
      native_language_code: 'uk',
      needs_onboarding: false,
    })

    for (const name of [langRu('ru'), langRu('pt'), langRu('es')]) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
      expect(screen.getByRole('checkbox', { name })).toBeEnabled()
    }
    expect(screen.getByRole('combobox', { name: 'Родной язык' })).toHaveTextContent('Выберите язык')

    await chooseNative(langRu('uk'))
    await user.click(screen.getByRole('button', { name: 'Готово' }))

    await waitFor(() =>
      expect(meApi.onboarding).toHaveBeenCalledWith({
        ui_language: 'ru',
        learning_languages: ['ru', 'pt', 'es'],
        native_language: 'uk',
      }),
    )
  })

  it('lets an onboarded user without a native language keep or drop existing languages', async () => {
    const user = userEvent.setup()
    vi.mocked(meApi.onboarding).mockResolvedValue({ ok: true, redirect: '/learn/pt/library' })
    await show(migratedUser)
    vi.mocked(meApi.get).mockResolvedValue({
      ...migratedUser,
      learning_languages: ['pt'],
      native_language_code: 'ru',
      needs_onboarding: false,
    })

    const russian = screen.getByRole('checkbox', { name: langRu('ru') })
    const portuguese = screen.getByRole('checkbox', { name: langRu('pt') })
    expect(russian).toBeChecked()
    expect(portuguese).toBeChecked()
    expect(russian).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Родной язык' })).not.toHaveTextContent(langRu('ru'))

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите родной язык')
    expect(meApi.onboarding).not.toHaveBeenCalled()

    await user.click(portuguese)
    expect(portuguese).not.toBeChecked()
    await user.click(portuguese)
    await chooseNative(langRu('ru'))
    expect(screen.getByRole('checkbox', { name: langRu('ru') })).not.toBeChecked()
    expect(
      screen.getByText(
        `${langRu('ru')} убран из изучаемых: родной язык нельзя изучать. Уроки и словарь сохранены.`,
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Готово' }))

    await waitFor(() =>
      expect(meApi.onboarding).toHaveBeenCalledWith({
        ui_language: 'ru',
        learning_languages: ['pt'],
        native_language: 'ru',
      }),
    )
  })

  it('explains a native-language conflict reported by the server', async () => {
    const user = userEvent.setup()
    vi.mocked(meApi.onboarding).mockRejectedValue(new ApiError(400, 'native_language_is_learning'))
    await show()
    await user.click(screen.getByRole('checkbox', { name: langRu('pt') }))
    await user.click(screen.getByRole('button', { name: 'Готово' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Родной язык не может быть изучаемым',
    )
  })
})
