import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorKey } from '@/api/client'
import { meApi } from '@/api/me'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLibraryStore } from '@/features/library/libraryStore'
import { useTranslation, msg } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { buttonClass, FormMessage, inputClass, SettingsSection } from './shared'

export function DataSettings() {
  const t = useTranslation()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null)
  const [exportError, setExportError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [downloaded, setDownloaded] = useState(false)

  async function download() {
    setBusy('export')
    setExportError('')
    setDownloaded(false)
    try {
      const data = await meApi.export()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `glosano-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloaded(true)
    } catch (error) {
      setExportError(getApiErrorKey(error))
    } finally {
      setBusy(null)
    }
  }

  function close() {
    if (busy === 'delete') return
    setStep(0)
    setPassword('')
    setDeleteError('')
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault()
    if (!password || step !== 2 || busy) return
    setBusy('delete')
    setDeleteError('')
    try {
      await meApi.delete(password)
      await cache.cancelQueries()
      useUserStore.getState().reset()
      useLibraryStore.getState().reset()
      cache.clear()
      setPassword('')
      setStep(0)
      await navigate({ to: '/login', replace: true })
    } catch (error) {
      setDeleteError(getApiErrorKey(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t('Export data')}>
        <p className="mb-5 text-sm text-muted-foreground">
          {t(
            'Download your profile, preferences, lessons, vocabulary, review history and statistics as JSON.',
          )}
        </p>
        <button className={buttonClass} onClick={() => void download()} disabled={busy !== null}>
          {t(busy === 'export' ? msg('Preparing download…') : msg('Download JSON'))}
        </button>
        <div className="mt-3">
          <FormMessage
            error={exportError && t(exportError)}
            success={downloaded ? t('Your download is ready.') : ''}
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t('Delete account')}>
        <p className="mb-5 text-sm text-muted-foreground">
          {t(
            'Deletion is permanent. Your profile, your own lessons, vocabulary and progress will be deleted.',
          )}
        </p>
        <button
          className="rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => setStep(1)}
        >
          {t('Delete account')}
        </button>
      </SettingsSection>
      <Dialog
        open={step !== 0}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent showCloseButton={busy !== 'delete'}>
          <DialogTitle>
            {t(step === 2 ? msg('Confirm deletion') : msg('Delete account'))}
          </DialogTitle>
          <DialogDescription>
            {t(
              step === 2
                ? msg('Enter your password to permanently delete your account.')
                : msg(
                    'Your own shared lessons will also be deleted. Other users’ lessons and the shared dictionary will remain.',
                  ),
            )}
          </DialogDescription>
          {step === 1 ? (
            <div className="flex flex-wrap justify-end gap-3">
              <button className="rounded-lg px-3 py-2 text-sm" onClick={close}>
                {t('Cancel')}
              </button>
              <button className={buttonClass} onClick={() => setStep(2)}>
                {t('Continue with deletion')}
              </button>
            </div>
          ) : (
            <form noValidate onSubmit={(e) => void remove(e)} className="space-y-4">
              <label htmlFor="delete-password" className="block text-sm font-medium">
                {t('Password')}
                <input
                  id="delete-password"
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy === 'delete'}
                  required
                  maxLength={128}
                />
              </label>
              <FormMessage error={deleteError && t(deleteError)} />
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm"
                  onClick={close}
                  disabled={busy === 'delete'}
                >
                  {t('Cancel')}
                </button>
                <button
                  className="rounded-lg bg-destructive px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={!password || busy !== null}
                >
                  {t(busy === 'delete' ? msg('Deleting…') : msg('Delete permanently'))}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
