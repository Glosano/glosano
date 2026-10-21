import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AIDraft, type AISettings } from '@/api/admin'
import { ApiError, getApiErrorMessage } from '@/api/client'
import { AppTopBar } from '@/components/AppTopBar'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { msg, useTranslation } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'

const presets = [
  ['OpenAI', 'https://api.openai.com/v1'],
  ['OpenRouter', 'https://openrouter.ai/api/v1'],
  ['Ollama', 'http://host.docker.internal:11434/v1'],
  ['LM Studio', 'http://host.docker.internal:1234/v1'],
] as const
const errors: Record<string, string> = {
  configuration_conflict: msg('Settings changed elsewhere. Reload before saving.'),
  key_action_required: msg('Enter a key for this server or choose no key.'),
  key_unreadable: msg('The saved key cannot be read. Enter it again or remove it.'),
  instance_secret_invalid: msg(
    'The instance secret is unsuitable for encryption. Contact the server owner.',
  ),
  ai_force_disabled: msg('AI is blocked by the server environment.'),
  invalid_endpoint: msg('Enter a valid server address. Metadata services are not allowed.'),
  https_required: msg('Use HTTPS for a public server.'),
  endpoint_model_required: msg('Enter the server address and model.'),
  api_key_required: msg('Enter a valid API key or choose no key.'),
  authorization_failed: msg('The server rejected the API key.'),
  model_not_found: msg('The model or endpoint was not found.'),
  models_unavailable: msg('This server does not list models. Enter the model manually.'),
  server_unavailable: msg('The server is unavailable. Check the address and connection.'),
  provider_timeout: msg('The server did not respond in time.'),
  provider_rate_limited: msg('The provider is limiting requests. Try again later.'),
  incompatible_response: msg('The server returned an incompatible response.'),
  response_too_large: msg('The server response was too large.'),
}
const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

function AIForm({ initial }: { initial: AISettings }) {
  const t = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AIDraft>({
    revision: initial.revision,
    enabled: initial.enabled,
    base_url: initial.base_url,
    model: initial.model,
    key_action: 'keep',
  })
  const [preset, setPreset] = useState<string>(
    presets.find(([, url]) => url === initial.base_url)?.[0] ?? 'custom',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [models, setModels] = useState<string[]>([])
  const version = useRef(0)

  function edit(patch: Partial<AIDraft>) {
    version.current++
    setDraft((current) => ({ ...current, ...patch }))
    setMessage('')
    setError('')
    setModels([])
  }
  function changeServer(base_url: string) {
    edit({ base_url, key_action: initial.has_key ? 'replace' : 'remove', api_key: '' })
  }
  async function act(action: 'save' | 'test' | 'models') {
    const current = version.current
    setBusy(true)
    setError('')
    setMessage('')
    // Keep credentials out of React Query's mutation cache and browser storage.
    const payload = {
      ...draft,
      api_key: draft.key_action === 'replace' ? draft.api_key : undefined,
    }
    try {
      if (action === 'save') {
        const saved = await adminApi.save(payload)
        queryClient.setQueryData(['admin-ai'], saved)
        await queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'admin-ai',
        })
      } else if (action === 'test') {
        await adminApi.test(payload)
        if (current === version.current) setMessage(t('Connection successful.'))
      } else {
        const result = await adminApi.models(payload)
        if (current === version.current) {
          setModels(result.models)
          if (!result.models.length)
            setMessage(t('This server does not list models. Enter the model manually.'))
        }
      }
    } catch (cause) {
      if (current === version.current)
        setError(
          cause instanceof ApiError && errors[cause.detail]
            ? t(errors[cause.detail]!)
            : getApiErrorMessage(cause),
        )
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-7"
      onSubmit={(event) => {
        event.preventDefault()
        void act('save')
      }}
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t('One connection for translations, chat and practice. AI is optional.')}
        </p>
        <p className="text-sm">
          {t('Configuration source')}:{' '}
          {t(initial.source === 'database' ? 'Application' : 'Environment')}
        </p>
        {initial.revision > 0 && (
          <p className="text-sm text-muted-foreground">{t('Saved configuration')}</p>
        )}
        {initial.force_disabled && (
          <p role="status" className="rounded-md bg-muted p-3">
            {t('AI is blocked by the server environment.')}
          </p>
        )}
        {initial.key_error && (
          <p role="alert" className="text-destructive">
            {t(errors[initial.key_error] ?? errors.key_unreadable!)}
          </p>
        )}
      </div>
      <label className="flex items-center gap-3 font-medium">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy || initial.force_disabled}
          onChange={(event) => edit({ enabled: event.target.checked })}
        />
        {t('Enable AI')}
      </label>
      <fieldset disabled={busy} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="ai-preset" className="block text-sm font-medium">
            {t('Connection preset')}
          </label>
          <select
            id="ai-preset"
            className={selectClass}
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value)
              const chosen = presets.find(([name]) => name === event.target.value)
              changeServer(chosen?.[1] ?? '')
            }}
          >
            {presets.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
            <option value="custom">{t('Other compatible server')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="ai-url" className="block text-sm font-medium">
            {t('Server address')}
          </label>
          <Input
            id="ai-url"
            type="url"
            value={draft.base_url}
            maxLength={2048}
            onChange={(event) => {
              setPreset('custom')
              changeServer(event.target.value)
            }}
            placeholder="https://example.com/v1"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'For a model on the Docker host, use host.docker.internal instead of localhost. The model server must already be running.',
            )}
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="ai-key-action" className="block text-sm font-medium">
            {t('API key')}
          </label>
          <select
            id="ai-key-action"
            className={selectClass}
            value={draft.key_action}
            onChange={(event) =>
              edit({ key_action: event.target.value as AIDraft['key_action'], api_key: '' })
            }
          >
            <option value="keep">{t(initial.has_key ? 'Keep saved key' : 'No saved key')}</option>
            <option value="replace">{t('Enter a new key')}</option>
            <option value="remove">{t('Use no key / remove saved key')}</option>
          </select>
          {draft.key_action === 'replace' && (
            <Input
              aria-label={t('New API key')}
              type="password"
              value={draft.api_key ?? ''}
              onChange={(event) => edit({ api_key: event.target.value })}
              autoComplete="new-password"
              maxLength={8192}
              spellCheck={false}
            />
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="ai-model" className="block text-sm font-medium">
            {t('Model identifier')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ai-model"
              list="ai-models"
              value={draft.model}
              maxLength={255}
              onChange={(event) => edit({ model: event.target.value })}
              placeholder="model-name"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              disabled={initial.force_disabled || !draft.base_url}
              onClick={() => void act('models')}
            >
              {t('Load models')}
            </Button>
          </div>
          <datalist id="ai-models">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {t('You can always enter the model identifier manually.')}
          </p>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {t(busy ? 'Working…' : 'Save AI settings')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || initial.force_disabled || !draft.base_url || !draft.model}
          onClick={() => void act('test')}
        >
          {t('Test connection')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-ai'] })}
        >
          {t('Reload settings')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          'Testing sends a short diagnostic request and may incur a provider charge. It does not change your active connection.',
        )}
      </p>
    </form>
  )
}

function AdminContent() {
  const t = useTranslation()
  const user = useUserStore((state) => state.user)
  const query = useQuery({
    queryKey: ['admin-ai'],
    queryFn: adminApi.get,
    enabled: user?.role === 'admin',
    retry: false,
    refetchOnWindowFocus: false,
  })
  return (
    <div className="min-h-screen bg-background">
      <AppTopBar />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="mb-2 text-2xl font-semibold">{t('AI settings')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('Administrator')}</p>
        {user?.role !== 'admin' ? (
          <p role="alert">{t('You do not have permission for this action.')}</p>
        ) : query.isPending ? (
          <p>{t('Loading…')}</p>
        ) : query.isError ? (
          <p role="alert">{getApiErrorMessage(query.error)}</p>
        ) : (
          <AIForm key={query.dataUpdatedAt} initial={query.data} />
        )}
      </main>
    </div>
  )
}
export function AISettingsPage() {
  return (
    <ProtectedRoute>
      <AdminContent />
    </ProtectedRoute>
  )
}
