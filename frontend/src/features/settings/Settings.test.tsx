import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { meApi, type MeResponse } from '@/api/me'
import { ApiError } from '@/api/client'
import { setUiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'

import { ProfileSettings } from './ProfileSettings'
import { PreferencesSettings } from './PreferencesSettings'
import { DataSettings } from './DataSettings'
import { ProtectedRoute } from '@/components/ProtectedRoute'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/api/me', () => ({
  meApi: {
    get: vi.fn(),
    updateProfile: vi.fn(),
    updatePreferences: vi.fn(),
    changePassword: vi.fn(),
    export: vi.fn(),
    delete: vi.fn(),
  },
}))

const user = {
  id: 'u1',
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
  daily_goal_reviews: 500,
} satisfies MeResponse

function show(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  useUserStore.getState().reset()
  setUiLanguage('ru')
  useUserStore.getState().setUser({ ...user })
})

describe('settings', () => {
  it.each(['en', 'ru'] as const)(
    'keeps saved %s preferences when an older profile refresh finishes later',
    async (language) => {
      let resolveStale!: (value: MeResponse) => void
      const staleResponse = new Promise<MeResponse>((resolve) => { resolveStale = resolve })
      vi.mocked(meApi.get).mockResolvedValueOnce({ ...user }).mockReturnValueOnce(staleResponse)
      const saved = {
        ...user,
        ui_language_code: language,
        preferred_translation_language_code: language,
        daily_goal_reviews: 25,
      }
      vi.mocked(meApi.updatePreferences).mockResolvedValue(saved)
      const cache = show(<ProtectedRoute><PreferencesSettings /></ProtectedRoute>)
      await screen.findByLabelText('Лимит повторений в день')
      let refresh!: Promise<void>
      act(() => { refresh = cache.refetchQueries({ queryKey: ['me'], exact: true }) })
      expect(meApi.get).toHaveBeenCalledTimes(2)
      fireEvent.change(screen.getByLabelText('Лимит повторений в день'), { target: { value: '25' } })
      fireEvent.change(screen.getByLabelText('Язык интерфейса'), { target: { value: language } })
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить предпочтения' }))
      await waitFor(() => expect(useUserStore.getState().user?.daily_goal_reviews).toBe(25))
      await act(async () => { resolveStale({ ...user }); await refresh })
      expect(cache.getQueryData(['me'])).toEqual(saved)
      expect(useUserStore.getState().user?.ui_language_code).toBe(language)
      expect(useUserStore.getState().user?.daily_goal_reviews).toBe(25)
    },
  )

  it('hydrates a cold profile route before initializing the form', async () => {
    useUserStore.getState().reset()
    vi.mocked(meApi.get).mockResolvedValue({ ...user, display_name: 'Fresh profile' })
    show(
      <ProtectedRoute>
        <ProfileSettings />
      </ProtectedRoute>,
    )
    await waitFor(() => expect(screen.getByLabelText('Имя')).toHaveValue('Fresh profile'))
  })

  it('hydrates locale, languages and goals on a cold preferences route', async () => {
    useUserStore.getState().reset()
    vi.mocked(meApi.get).mockResolvedValue({
      ...user,
      ui_language_code: 'en',
      learning_languages: ['ru'],
      daily_goal_minutes: 45,
      daily_goal_reviews: 35,
    })
    show(
      <ProtectedRoute>
        <PreferencesSettings />
      </ProtectedRoute>,
    )
    await waitFor(() => expect(screen.getByLabelText('Daily review limit')).toHaveValue(35))
    expect(screen.getByLabelText('Interface language')).toHaveValue('en')
    expect(screen.getByRole('checkbox', { name: 'Russian' })).toBeChecked()
    expect(screen.getByLabelText('Reading goal, minutes per day')).toHaveValue(45)
  })

  it('offers the complete localized learning-language catalog with flags', () => {
    show(<PreferencesSettings />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(10)
    expect(screen.getByRole('checkbox', { name: 'Китайский (упрощённый)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Арабский' })).toBeInTheDocument()
    expect(screen.getByText('🇨🇳')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('🇸🇦')).toHaveAttribute('aria-hidden', 'true')
  })

  it('invalidates cached review queues when only the daily limit changes', async () => {
    vi.mocked(meApi.updatePreferences).mockResolvedValue({ ...user, daily_goal_reviews: 25 })
    const cache = show(<PreferencesSettings />)
    cache.setQueryData(['review-queue', 'pt', 'ru'], { daily: { limit: 500 } })
    cache.setQueryData(['review-counts', 'pt', 'ru'], { due: 50 })
    fireEvent.change(screen.getByLabelText('Лимит повторений в день'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить предпочтения' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Сохранено'))
    expect(cache.getQueryState(['review-queue', 'pt', 'ru'])?.isInvalidated).toBe(true)
    expect(cache.getQueryState(['review-counts', 'pt', 'ru'])?.isInvalidated).toBe(true)
  })

  it('saves the profile and refreshes the name in the user store', async () => {
    vi.mocked(meApi.updateProfile).mockResolvedValue({ ...user, display_name: 'New name' })
    show(<ProfileSettings />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() => expect(useUserStore.getState().user?.display_name).toBe('New name'))
    expect(meApi.updateProfile).toHaveBeenCalledWith({ display_name: 'New name' })
  })

  it('does not send mismatched new passwords', () => {
    show(<ProfileSettings />)
    fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('Повторите новый пароль'), {
      target: { value: 'different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Пароли не совпадают.')
    expect(meApi.changePassword).not.toHaveBeenCalled()
  })

  it('keeps at least one learning language and persists the UI-derived target', async () => {
    vi.mocked(meApi.updatePreferences).mockResolvedValue({
      ...user,
      ui_language_code: 'en',
      preferred_translation_language_code: 'en',
    })
    show(<PreferencesSettings />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Португальский' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить предпочтения' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Выберите хотя бы один язык.')
    expect(meApi.updatePreferences).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Португальский' }))
    fireEvent.change(screen.getByLabelText('Язык интерфейса'), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить предпочтения' }))
    await waitFor(() => expect(screen.getByText('Interface language')).toBeInTheDocument())
    expect(meApi.updatePreferences).toHaveBeenCalledWith({
      ui_language: 'en',
      learning_languages: ['pt'],
      daily_goal_minutes: 15,
      daily_goal_reviews: 500,
    })
    expect(useUserStore.getState().user?.preferred_translation_language_code).toBe('en')
  })

  it('keeps data until the second confirmation with password succeeds', async () => {
    vi.mocked(meApi.delete).mockResolvedValue({ ok: true })
    const cache = show(<DataSettings />)
    cache.setQueryData(['private'], { value: 'sensitive' })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
    expect(meApi.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить удаление' }))
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'old-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true }))
    expect(meApi.delete).toHaveBeenCalledWith('old-password')
    expect(useUserStore.getState().user).toBeNull()
    expect(cache.getQueryData(['private'])).toBeUndefined()
  })

  it('localizes the data page when the locale changes', () => {
    show(<DataSettings />)
    act(() => setUiLanguage('en'))
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
  })

  it('preserves the account and entered password when deletion fails', async () => {
    vi.mocked(meApi.delete).mockRejectedValue(new ApiError(401, 'Invalid password'))
    show(<DataSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }))
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить удаление' }))
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'incorrect' } })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Неверный пароль.'))
    expect(useUserStore.getState().user?.id).toBe('u1')
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('downloads the returned JSON and leaves user data intact', async () => {
    const data = { schema_version: 1, user: { display_name: 'Learner' }, lessons: [] }
    vi.mocked(meApi.export).mockResolvedValue(data)
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:test-export')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    show(<DataSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Скачать JSON' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Файл подготовлен.'))
    expect(meApi.export).toHaveBeenCalledOnce()
    const blob = create.mock.calls[0]?.[0] as unknown as Blob
    expect(blob.type).toBe('application/json')
    const downloaded = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(JSON.parse(downloaded)).toEqual(data)
    expect(useUserStore.getState().user?.id).toBe('u1')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('does not replace the saved profile on a failed request', async () => {
    vi.mocked(meApi.updateProfile).mockRejectedValue(new Error('offline'))
    show(<ProfileSettings />)
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Not saved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(useUserStore.getState().user?.display_name).toBe('Learner')
    expect(screen.getByLabelText('Имя')).toHaveValue('Not saved')
  })
})
