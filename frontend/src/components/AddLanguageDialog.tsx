import { useEffect, useState, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorKey } from '@/api/client'
import { meApi } from '@/api/me'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import {
  LEARNING_LANGUAGES,
  learningLanguageLabel,
  type LearningLanguageCode,
} from '@/lib/languages'
import { useUserStore } from '@/stores/userStore'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLButtonElement | null>
}

export function AddLanguageDialog({ open, onOpenChange, returnFocusRef }: Props) {
  const { language, t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useUserStore((state) => state.user)
  const [selected, setSelected] = useState<LearningLanguageCode | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const allAdded = LEARNING_LANGUAGES.every((item) => user?.learning_languages.includes(item.code))

  useEffect(() => {
    if (!open) {
      setSelected(null)
      setPending(false)
      setError('')
    }
  }, [open])

  function changeOpen(next: boolean) {
    if (!next && pending) return
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || pending) return
    setPending(true)
    setError('')
    try {
      await queryClient.cancelQueries({ queryKey: ['me'], exact: true })
      const updated = await meApi.addLearningLanguage(selected)
      useUserStore.getState().setUser(updated)
      queryClient.setQueryData(['me'], updated)
      onOpenChange(false)
      await navigate({ to: '/learn/$lang/library', params: { lang: selected } })
    } catch (reason) {
      setError(getApiErrorKey(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('Добавить язык')}</DialogTitle>
          <DialogDescription>{t('Выберите язык, который хотите изучать.')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={pending} className="grid max-h-[50vh] gap-1 overflow-y-auto">
            <legend className="sr-only">{t('Изучаемые языки')}</legend>
            {LEARNING_LANGUAGES.map((item) => {
              const disabled = user?.learning_languages.includes(item.code) ?? false
              const label = learningLanguageLabel(item.code, language)
              return (
                <label
                  key={item.code}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-50"
                >
                  <input
                    type="radio"
                    name="learning-language"
                    value={item.code}
                    checked={selected === item.code}
                    disabled={disabled}
                    onChange={() => setSelected(item.code)}
                  />
                  <span aria-hidden="true" className="text-lg">
                    {item.flag}
                  </span>
                  <span>{label}</span>
                </label>
              )
            })}
          </fieldset>
          {allAdded && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('Все доступные языки уже добавлены.')}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t(error)}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={!selected || pending || allAdded}>
              {t(pending ? 'Добавление…' : 'Добавить')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              {t('Отмена')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
