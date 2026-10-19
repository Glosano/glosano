import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('@/api/auth', () => ({ authApi: { register: vi.fn() } }))
vi.mock('@/api/me', () => ({ meApi: { get: vi.fn() } }))

import { authApi } from '@/api/auth'
import { meApi, type MeResponse } from '@/api/me'
import {
  __resetCatalogsForTests,
  __setCatalogLoaderForTests,
  getUiLanguage,
  loadCatalog,
  setUiLanguage,
} from '@/lib/i18n'
import { UI_LANGUAGE_CODES, uiLanguageEndonym } from '@/lib/uiLanguages'

import { AuthLanguagePicker } from './AuthLanguagePicker'
import { RegisterForm } from './RegisterForm'

const STORAGE_KEY = 'glosano.ui-language'

afterEach(async () => {
  __resetCatalogsForTests()
  await Promise.all(UI_LANGUAGE_CODES.map(loadCatalog))
  await act(async () => {
    await setUiLanguage('ru')
  })
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AuthLanguagePicker', () => {
  it('lists every interface language under its own name and shows the active one', () => {
    render(<AuthLanguagePicker />)
    const picker = screen.getByRole('combobox', { name: 'Язык интерфейса' })
    const options = within(picker).getAllByRole('option')
    expect(options.map((option) => option.getAttribute('value'))).toEqual([...UI_LANGUAGE_CODES])
    expect(options.map((option) => option.textContent)).toEqual(
      UI_LANGUAGE_CODES.map((code) => uiLanguageEndonym(code)),
    )
    expect(picker).toHaveValue('ru')
  })

  it('switches the interface and remembers the choice on this device', async () => {
    localStorage.clear()
    render(<AuthLanguagePicker />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Язык интерфейса' }), {
      target: { value: 'de' },
    })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Sprache der Benutzeroberfläche' })).toHaveValue(
        'de',
      ),
    )
    expect(getUiLanguage()).toBe('de')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so and keeps the current language when the catalog fails to load', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    __resetCatalogsForTests()
    await Promise.all([loadCatalog('en'), loadCatalog('ru')])
    __setCatalogLoaderForTests(() => Promise.reject(new Error('offline')))
    localStorage.clear()
    try {
      render(<AuthLanguagePicker />)
      const picker = screen.getByRole('combobox', { name: 'Язык интерфейса' })
      fireEvent.change(picker, { target: { value: 'ja' } })

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Не удалось загрузить этот язык. Проверьте подключение и попробуйте снова.',
      )
      expect(picker).toHaveValue('ru')
      expect(picker).toBeEnabled()
      expect(picker).toHaveAccessibleDescription(
        'Не удалось загрузить этот язык. Проверьте подключение и попробуйте снова.',
      )
      expect(getUiLanguage()).toBe('ru')
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      expect(logged).toHaveBeenCalled()

      // A later choice that loads clears the error.
      fireEvent.change(picker, { target: { value: 'en' } })
      await waitFor(() => expect(getUiLanguage()).toBe('en'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      logged.mockRestore()
    }
  })

  it('registers the account with the language picked before sign-up', async () => {
    vi.mocked(authApi.register).mockResolvedValue(undefined as never)
    vi.mocked(meApi.get).mockResolvedValue({ ui_language_code: 'pt' } as MeResponse)
    render(
      <>
        <AuthLanguagePicker />
        <RegisterForm />
      </>,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Язык интерфейса' }), {
      target: { value: 'pt' },
    })
    await waitFor(() => expect(getUiLanguage()).toBe('pt'))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Endereço de email'), {
      target: { value: 'ana@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Palavra-passe'), {
      target: { value: 'long-enough-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() =>
      expect(authApi.register).toHaveBeenCalledWith({
        display_name: 'Ana',
        email: 'ana@example.com',
        password: 'long-enough-password',
        ui_language: 'pt',
      }),
    )
  })
})
