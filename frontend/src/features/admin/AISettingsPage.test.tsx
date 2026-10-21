import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi, type AISettings } from '@/api/admin'
import { ApiError } from '@/api/client'
import { setUiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { AISettingsPage } from './AISettingsPage'

vi.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/AppTopBar', () => ({ AppTopBar: () => null }))
const initial: AISettings = {
  revision: 0,
  source: 'environment',
  enabled: false,
  base_url: 'https://api.openai.com/v1',
  model: '',
  has_key: false,
  force_disabled: false,
  key_error: null,
}
function mount(role: 'admin' | 'learner' = 'admin') {
  useUserStore.setState({
    user: {
      id: 'a',
      email: 'admin@example.com',
      role,
      display_name: 'Admin',
      ui_language_code: 'en',
      learning_languages: ['en'],
      native_language_code: 'ru',
      last_learning_language_code: 'en',
      needs_onboarding: false,
      onboarded_at: null,
    },
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AISettingsPage />
    </QueryClientProvider>,
  )
  return queryClient
}
beforeEach(async () => {
  vi.restoreAllMocks()
  await act(async () => {
    await setUiLanguage('en')
  })
  vi.spyOn(adminApi, 'get').mockResolvedValue(initial)
  vi.spyOn(adminApi, 'save').mockResolvedValue({ ...initial, source: 'database', revision: 1 })
  vi.spyOn(adminApi, 'test').mockResolvedValue({ ok: true })
  vi.spyOn(adminApi, 'models').mockResolvedValue({ models: ['example-model'] })
})
describe('AI administration', () => {
  it('does not fetch settings for learners', async () => {
    mount('learner')
    expect(await screen.findByRole('alert')).toHaveTextContent('permission')
    expect(adminApi.get).not.toHaveBeenCalled()
  })
  it('edits a draft, tests explicitly and clears credentials after saving', async () => {
    const user = userEvent.setup()
    const cache = mount()
    await screen.findByLabelText('Model identifier')
    expect(adminApi.test).not.toHaveBeenCalled()
    expect(adminApi.models).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Model identifier'), 'my-model')
    await user.selectOptions(screen.getByLabelText('API key'), 'replace')
    await user.type(screen.getByLabelText('New API key'), 'private-key')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Connection successful')
    expect(adminApi.save).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Model identifier'), '-v2')
    expect(screen.queryByText('Connection successful.')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Enable AI'))
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }))
    await waitFor(() => expect(screen.queryByLabelText('New API key')).not.toBeInTheDocument())
    expect(adminApi.save).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, model: 'my-model-v2', api_key: 'private-key' }),
    )
    expect(cache.getMutationCache().getAll()).toHaveLength(0)
    expect(JSON.stringify(cache.getQueryData(['admin-ai']))).not.toContain('private-key')
  })
  it('retains fields on conflict and keeps model entry usable when listing is unsupported', async () => {
    vi.mocked(adminApi.models).mockRejectedValue(new ApiError(422, 'models_unavailable'))
    vi.mocked(adminApi.save).mockRejectedValue(new ApiError(409, 'configuration_conflict'))
    const user = userEvent.setup()
    mount()
    await screen.findByLabelText('Model identifier')
    await user.click(screen.getByRole('button', { name: 'Load models' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the model manually')
    await user.type(screen.getByLabelText('Model identifier'), 'typed-model')
    await user.click(screen.getByRole('button', { name: 'Save AI settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere')
    expect(screen.getByLabelText('Model identifier')).toHaveValue('typed-model')
  })
  it('does not carry a saved credential to another server', async () => {
    vi.mocked(adminApi.get).mockResolvedValue({
      ...initial,
      has_key: true,
      revision: 2,
      source: 'database',
    })
    const user = userEvent.setup()
    mount()
    await screen.findByLabelText('API key')
    await user.selectOptions(screen.getByLabelText('Connection preset'), 'Ollama')
    expect(screen.getByLabelText('API key')).toHaveValue('replace')
    expect(screen.getByLabelText('New API key')).toHaveValue('')
    expect(adminApi.test).not.toHaveBeenCalled()
  })
  it('shows the force-disable reason and blocks diagnostics', async () => {
    vi.mocked(adminApi.get).mockResolvedValue({ ...initial, force_disabled: true, model: 'm' })
    mount()
    expect(await screen.findByRole('status')).toHaveTextContent('blocked')
    expect(screen.getByLabelText('Enable AI')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load models' })).toBeDisabled()
  })
})
