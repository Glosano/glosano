import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, getApiErrorMessage } from '@/api/client'
import { lessonsApi, type LessonSummary } from '@/api/lessons'
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
import { useTranslation } from '@/lib/i18n'
import { parseTagInput, tagInputError } from '@/lib/tags'

export function LessonTagsDialog({
  lesson,
  onClose,
  onRestoreFocus,
}: {
  lesson: LessonSummary
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const t = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState((lesson.tags ?? []).join(', '))
  const [inputError, setInputError] = useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['lessons', lesson.language_code] })
  const save = useMutation({
    mutationFn: (tags: string[]) => lessonsApi.setTags(lesson.id, tags),
    onSuccess: () => {
      onClose()
      void refresh()
    },
    onError: (error) => {
      // The lesson was deleted or unshared meanwhile: refresh the list behind the dialog.
      if (error instanceof ApiError && error.status === 404) void refresh()
    },
  })
  const unavailable = save.error instanceof ApiError && save.error.status === 404
  const message = inputError
    ? t(inputError)
    : unavailable
      ? t('Материал недоступен.')
      : save.isError
        ? getApiErrorMessage(save.error)
        : null

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const tags = parseTagInput(value)
    const error = tagInputError(tags)
    setInputError(error)
    if (!error) save.mutate(tags)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('Теги материала')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {t('«{{title}}». Теги видны только вам.', { title: lesson.title })}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="material-tags">{t('Теги (через запятую)')}</Label>
            <Input
              id="material-tags"
              value={value}
              disabled={save.isPending}
              placeholder={t('например: новости, подкаст')}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              {t('Отмена')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('Сохранение…') : t('Сохранить')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
