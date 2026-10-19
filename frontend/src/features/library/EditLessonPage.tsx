import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, getApiErrorMessage } from '@/api/client'
import { lessonsApi, type LessonEditData } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation, msg } from '@/lib/i18n'
import { invalidateMaterial } from './materialQueries'
import { mediaTime } from '@/lib/mediaTime'

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
      <h1 className="mb-6 text-2xl font-semibold">{t('Edit material')}</h1>
      {lesson.isPending && <p role="status">{t('Loading…')}</p>}
      {lesson.isError && (
        <div className="space-y-4">
          <p role="alert" className="text-destructive">
            {unavailable
              ? t('Material not found or unavailable for editing.')
              : t('Could not load the material')}
          </p>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
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
  const [fragments, setFragments] = useState(lesson.fragments ?? [])
  const [validation, setValidation] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      lessonsApi.update(
        lesson.id,
        lesson.media
          ? {
              title: title.trim(),
              source_version: lesson.source_version!,
              fragments: fragments.map(({ seg_id, text: fragmentText }) => ({
                seg_id,
                text: fragmentText,
              })),
            }
          : { title: title.trim(), raw_text: text },
      ),
    onSuccess: () => {
      void invalidateMaterial(queryClient, lesson.id, lang)
      onClose()
    },
  })
  const error =
    save.error instanceof ApiError && save.error.status === 409
      ? t(
          lesson.media
            ? msg('The material has changed or is still processing. Reload before saving.')
            : msg('The material is still processing. Try saving again later.'),
        )
      : getApiErrorMessage(save.error)
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (save.isPending) return
        setValidation(null)
        if (
          !title.trim() ||
          (lesson.media ? fragments.some((fragment) => !fragment.text.trim()) : !text.trim())
        ) {
          setValidation(msg('Enter a title and text'))
          return
        }
        if ([...title.trim()].length > 200) {
          setValidation(msg('The title must contain no more than 200 characters.'))
          return
        }
        save.mutate()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="edit-lesson-title">{t('Title')}</Label>
        <Input
          id="edit-lesson-title"
          value={title}
          disabled={save.isPending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        {lesson.media ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('Edit text within each fragment. Timing and order stay the same.')}
            </p>
            {fragments.map((fragment, index) => (
              <div key={fragment.seg_id} className="space-y-2 py-2">
                <Label htmlFor={`fragment-${fragment.seg_id}`}>
                  {t('Fragment {{number}} · {{range}}', {
                    number: index + 1,
                    range: `${mediaTime(fragment.media_start_ms)}–${mediaTime(fragment.media_end_ms)}`,
                  })}
                </Label>
                <textarea
                  id={`fragment-${fragment.seg_id}`}
                  rows={3}
                  value={fragment.text}
                  disabled={save.isPending}
                  onChange={(event) =>
                    setFragments((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, text: event.target.value } : item,
                      ),
                    )
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 leading-relaxed"
                />
              </div>
            ))}
          </>
        ) : (
          <>
            <Label htmlFor="edit-lesson-text">{t('Text')}</Label>
            <textarea
              id="edit-lesson-text"
              rows={18}
              value={text}
              disabled={save.isPending}
              onChange={(event) => setText(event.target.value)}
              className="flex min-h-72 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            'Changing the text resets the reading position. Saved words, reviews and statistics will remain.',
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
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('Saving…') : t('Save')}
        </Button>
      </div>
    </form>
  )
}
