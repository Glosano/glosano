import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('@/api/auth', () => ({ authApi: { login: vi.fn(), register: vi.fn() } }))

import { authApi } from '@/api/auth'
import { setUiLanguage } from '@/lib/i18n'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'

afterEach(() => {
  act(() => setUiLanguage('ru'))
  vi.clearAllMocks()
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

describe('Authentication localization', () => {
  it('renders localized login validation instead of native browser messages', () => {
    setUiLanguage('en')
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid-address' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'learner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.')
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('alert')).toHaveTextContent('Введите пароль.')
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('validates registration name and password bounds in the selected locale', () => {
    setUiLanguage('en')
    render(<RegisterForm />)
    const submit = screen.getByRole('button', { name: 'Create account' })
    fireEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a display name of 1 to 80 characters.',
    )
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'learner@example.com' } })
    for (const password of ['short', 'x'.repeat(129)]) {
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
      fireEvent.click(submit)
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password must contain 10 to 128 characters.',
      )
    }
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Пароль должен содержать от 10 до 128 символов.',
    )
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('switches labels and an already rendered login error without clearing user input', async () => {
    setUiLanguage('en')
    vi.mocked(authApi.login).mockRejectedValue(new Error('invalid credentials'))
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'learner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'some-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Incorrect email or password')).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByLabelText('Электронная почта')).toHaveValue('learner@example.com')
    expect(screen.getByText('Неверный email или пароль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вход' })).toBeInTheDocument()
  })

  it('renders registration labels and password guidance in English', () => {
    setUiLanguage('en')
    render(<RegisterForm />)
    expect(screen.getByRole('heading', { name: 'Sign up' })).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('heading', { name: 'Регистрация' })).toBeInTheDocument()
  })
})
