import { useTranslation } from '@/lib/i18n'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'

import { lessonsApi } from '@/api/lessons'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportLessonDialog({ open, onOpenChange }: Props) {
  const t = useTranslation()
  const params = useParams({ strict: false }) as { lang?: string }
  const lang = params.lang ?? 'en'
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<unknown>(null)

  const create = useMutation({
    mutationFn: (data: { title: string; raw_text: string }) =>
      lessonsApi.create({
        title: data.title,
        language_code: lang,
        raw_text: data.raw_text,
        visibility: 'private',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
      setTitle('')
      setText('')
      setError(null)
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      setError(err)
    },
  })

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!title.trim() || !text.trim()) {
      setError('Заполните название и текст')
      return
    }
    if ([...title.trim()].length > 200) {
      setError('Название должно содержать не более 200 символов.')
      return
    }
    create.mutate({ title: title.trim(), raw_text: text.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('Импорт урока')}</DialogTitle>
          <DialogDescription>
            {t('Вставьте текст для нового урока на текущем языке ({{language}}).', {
              language: lang.toUpperCase(),
            })}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lesson-title">{t('Название')}</Label>
            <Input
              id="lesson-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lesson-text">{t('Текст')}</Label>
            <textarea
              id="lesson-text"
              required
              rows={10}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
              }}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            />
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {typeof error === 'string' ? t(error) : getApiErrorMessage(error)}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t('Отмена')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('Сохранение…') : t('Создать урок')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
