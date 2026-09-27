import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../../lib/errors'
import { t } from '../../lib/i18n'
import { requestStatus, type Status } from '../../lib/messages'
import { requestHostPermission } from '../../lib/permissions'
import { getSettings, normalizeOrigin, saveInstanceOrigin } from '../../lib/settings'

function statusText(status: Status): string {
  switch (status.status) {
    case 'ready':
      return t('options_connected', status.me.display_name)
    case 'unconfigured':
      return ''
    case 'no_permission':
      return errorMessage({ code: 'no_permission' })
    case 'unreachable':
      return errorMessage({ code: 'unreachable', detail: status.origin })
    case 'signed_out':
      return errorMessage({ code: 'signed_out' })
    case 'needs_onboarding':
      return errorMessage({ code: 'needs_onboarding' })
  }
}

export default function App() {
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')
  // A slower mount-time check resolving after a newer submit must not clobber the
  // submit's result, and no state update should land after the component unmounts.
  const submittedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    // Idempotent under StrictMode's dev-mode setup -> cleanup -> setup: the ref must
    // be flipped back to true on the second setup, not just left false by the first
    // cleanup, or every guarded state update below becomes a permanent no-op.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void getSettings().then((s) => {
      if (!mountedRef.current || submittedRef.current) return
      if (s.instanceOrigin) setValue(s.instanceOrigin)
    })
    void requestStatus().then((s) => {
      if (!mountedRef.current || submittedRef.current) return
      setMessage(statusText(s))
    })
  }, [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const origin = normalizeOrigin(value)
    if (!origin) {
      setMessage(t('options_invalid_url'))
      return
    }
    submittedRef.current = true
    // The permission prompt must start inside the click handler, before any await.
    void requestHostPermission(origin)
      .then(async (granted) => {
        if (!granted) {
          if (mountedRef.current) setMessage(t('options_permission_denied'))
          return
        }
        await saveInstanceOrigin(origin)
        if (!mountedRef.current) return
        setValue(origin)
        setMessage(t('options_checking'))
        const status = await requestStatus()
        if (!mountedRef.current) return
        setMessage(statusText(status))
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return
        setMessage(errorMessage({ code: 'unknown', detail: String(error) }))
      })
  }

  return (
    <main className="mx-auto max-w-lg p-6 font-sans text-sm text-slate-900">
      <h1 className="mb-4 text-lg font-semibold">{t('options_title')}</h1>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="origin" className="font-medium">
          {t('options_url_label')}
        </label>
        <input
          id="origin"
          type="url"
          value={value}
          placeholder={t('options_url_placeholder')}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          {t('options_save')}
        </button>
        <p role="status" className="min-h-5 text-slate-700">
          {message}
        </p>
      </form>
    </main>
  )
}
