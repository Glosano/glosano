import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorKey } from '@/api/client'
import { meApi } from '@/api/me'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/i18n'
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
      link.download = `flinq-export-${new Date().toISOString().slice(0, 10)}.json`
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
      <SettingsSection title={t('Экспорт данных')}>
        <p className="mb-5 text-sm text-muted-foreground">
          {t(
            'Скачайте профиль, настройки, уроки, словарь, историю повторений и статистику в JSON.',
          )}
        </p>
        <button className={buttonClass} onClick={() => void download()} disabled={busy !== null}>
          {t(busy === 'export' ? 'Подготовка файла…' : 'Скачать JSON')}
        </button>
        <div className="mt-3">
          <FormMessage
            error={exportError && t(exportError)}
            success={downloaded ? t('Файл подготовлен.') : ''}
          />
        </div>
      </SettingsSection>
      <SettingsSection title={t('Удалить аккаунт')}>
        <p className="mb-5 text-sm text-muted-foreground">
          {t(
            'Удаление необратимо. Будут удалены ваш профиль, собственные уроки, словарь и прогресс.',
          )}
        </p>
        <button
          className="rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => setStep(1)}
        >
          {t('Удалить аккаунт')}
        </button>
      </SettingsSection>
      <Dialog
        open={step !== 0}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent showCloseButton={busy !== 'delete'}>
          <DialogTitle>{t(step === 2 ? 'Подтвердите удаление' : 'Удалить аккаунт')}</DialogTitle>
          <DialogDescription>
            {t(
              step === 2
                ? 'Введите пароль, чтобы окончательно удалить аккаунт.'
                : 'Собственные опубликованные уроки тоже будут удалены. Уроки других пользователей и общий словарь останутся.',
            )}
          </DialogDescription>
          {step === 1 ? (
            <div className="flex flex-wrap justify-end gap-3">
              <button className="rounded-lg px-3 py-2 text-sm" onClick={close}>
                {t('Отмена')}
              </button>
              <button className={buttonClass} onClick={() => setStep(2)}>
                {t('Продолжить удаление')}
              </button>
            </div>
          ) : (
            <form noValidate onSubmit={(e) => void remove(e)} className="space-y-4">
              <label htmlFor="delete-password" className="block text-sm font-medium">
                {t('Пароль')}
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
                  {t('Отмена')}
                </button>
                <button
                  className="rounded-lg bg-destructive px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={!password || busy !== null}
                >
                  {t(busy === 'delete' ? 'Удаление…' : 'Удалить навсегда')}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
