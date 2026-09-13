import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, getApiErrorMessage } from '@/api/client'
import { lessonsApi, type LessonEditData } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/i18n'
import { invalidateMaterial } from './materialQueries'

interface Props {
  lessonId: string
  lang: string
  onClose: () => void
}

export function EditLessonPage({ lessonId, lang, onClose }: Props) {
  const t = useTranslation()
  const lesson = useQuery({
    queryKey: ['lesson-edit', lessonId],
    queryFn: () => lessonsApi.getForEdit(lessonId),
    retry: false,
  })
  const unavailable = lesson.error instanceof ApiError && lesson.error.status === 404
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('Редактирование материала')}</h1>
      {lesson.isPending && <p role="status">{t('Загрузка…')}</p>}
      {lesson.isError && (
        <div className="space-y-4">
          <p role="alert" className="text-destructive">
            {unavailable
              ? t('Материал не найден или недоступен для редактирования.')
              : t('Ошибка загрузки материала')}
          </p>
          <Button variant="outline" onClick={onClose}>
            {t('Отмена')}
          </Button>
        </div>
      )}
      {lesson.data && (
        <LessonEditForm key={lessonId} lesson={lesson.data} lang={lang} onClose={onClose} />
      )}
    </div>
  )
}

function LessonEditForm({
  lesson,
  lang,
  onClose,
}: {
  lesson: LessonEditData
  lang: string
  onClose: () => void
}) {
  const t = useTranslation()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(lesson.title)
  const [text, setText] = useState(lesson.raw_text)
  const [validation, setValidation] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => lessonsApi.update(lesson.id, { title: title.trim(), raw_text: text }),
    onSuccess: () => {
      void invalidateMaterial(queryClient, lesson.id, lang)
      onClose()
    },
  })
  const error =
    save.error instanceof ApiError && save.error.status === 409
      ? t('Материал ещё обрабатывается. Попробуйте сохранить позже.')
      : getApiErrorMessage(save.error)
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (save.isPending) return
        setValidation(null)
        if (!title.trim() || !text.trim()) {
          setValidation('Заполните название и текст')
          return
        }
        if ([...title.trim()].length > 200) {
          setValidation('Название должно содержать не более 200 символов.')
          return
        }
        save.mutate()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="edit-lesson-title">{t('Название')}</Label>
        <Input
          id="edit-lesson-title"
          value={title}
          disabled={save.isPending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-lesson-text">{t('Текст')}</Label>
        <textarea
          id="edit-lesson-text"
          rows={18}
          value={text}
          disabled={save.isPending}
          onChange={(event) => setText(event.target.value)}
          className="flex min-h-72 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <p className="text-sm text-muted-foreground">
          {t(
            'Изменение текста сбросит позицию чтения. Сохранённые слова, повторения и статистика останутся.',
          )}
        </p>
      </div>
      {(validation || save.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {validation ? t(validation) : error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
          {t('Отмена')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('Сохранение…') : t('Сохранить')}
        </Button>
      </div>
    </form>
  )
}
