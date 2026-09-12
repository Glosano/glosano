import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Radix Select scrolls the highlighted option; jsdom has no layout API.
Element.prototype.scrollIntoView = vi.fn()

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/api/me', () => ({ meApi: { onboarding: vi.fn(), get: vi.fn() } }))

import { meApi, type MeResponse } from '@/api/me'
import { setUiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { OnboardingForm } from './OnboardingForm'

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
  it('offers all ten learning languages with localized names and decorative flags', () => {
    setUiLanguage('en')
    render(<OnboardingForm />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(10)
    expect(screen.getByRole('checkbox', { name: 'Chinese (Simplified)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Arabic' })).toBeInTheDocument()
    expect(screen.getByText('🇨🇳')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('🇸🇦')).toHaveAttribute('aria-hidden', 'true')
  })

  it('previews the selected interface language and derives the translation target', async () => {
    const user = userEvent.setup()
    const me = {
      id: 'u',
      email: 'user@example.com',
      role: 'learner' as const,
      display_name: 'Alex',
      ui_language_code: 'en',
      learning_languages: ['pt'],
      last_learning_language_code: 'pt',
      needs_onboarding: false,
      onboarded_at: '2026-09-11T00:00:00Z',
      preferred_translation_language_code: 'en' as const,
      daily_goal_minutes: 15,
      daily_goal_reviews: 20,
    } satisfies MeResponse
    vi.mocked(meApi.onboarding).mockResolvedValue({ ok: true, redirect: '/learn/pt/library' })
    vi.mocked(meApi.get).mockResolvedValue(me)
    render(<OnboardingForm />)
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    const selector = screen.getByRole('combobox', { name: 'Язык интерфейса' })
    selector.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('option', { name: 'English' }))
    expect(screen.getByRole('heading', { name: 'Welcome to Flinq' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Portuguese' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(meApi.onboarding).toHaveBeenCalledWith({
        ui_language: 'en',
        learning_languages: ['pt'],
        translation_language: 'en',
      }),
    )
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/learn/$lang/library', params: { lang: 'pt' } }),
    )
  })

  it('updates an existing validation error when the UI language changes', () => {
    render(<OnboardingForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.getByText('Выберите хотя бы один язык')).toBeInTheDocument()
    act(() => setUiLanguage('en'))
    expect(screen.getByText('Select at least one language')).toBeInTheDocument()
    expect(meApi.onboarding).not.toHaveBeenCalled()
  })
})
