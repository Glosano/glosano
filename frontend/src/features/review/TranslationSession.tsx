import { useI18n } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { reviewApi } from '@/api/review'
import { LessonEmptyState, SessionShell } from './sessionUi'

const SUBTITLE = 'Практика перевода'

interface TranslationTaskExercise {
  sentence_translation: string
}

export function TranslationSession(props: { lang: string; lessonId?: string }) {
  const { language } = useI18n()
  return (
    <TranslationSessionContent
      key={`${language}:${props.lang}:${props.lessonId ?? ''}`}
      {...props}
    />
  )
}

function TranslationSessionContent({ lang, lessonId }: { lang: string; lessonId?: string }) {
  const { language, t } = useI18n()
  const subtitle = lessonId ? t('{{value0}} · Слова урока', { value0: t(SUBTITLE) }) : t(SUBTITLE)

  const queue = useQuery({
    queryKey: ['review-queue', lang, 'practice', lessonId ?? null, language],
    queryFn: () => reviewApi.queue(lang, lessonId, 'practice'),
    staleTime: Infinity,
    gcTime: 0,
  })

  const [idx, setIdx] = useState(0)
  const [userText, setUserText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const items = queue.data?.items ?? []
  const total = items.length
  const current = items[idx]

  const exercise = useQuery({
    queryKey: ['exercise', language, 'translation_task', current?.review_item_id ?? null],
    queryFn: () =>
      reviewApi.exercise<TranslationTaskExercise>({
        kind: 'translation_task',
        review_item_id: current!.review_item_id,
      }),
    enabled: current !== undefined,
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => {
    setUserText('')
    setFeedback(null)
  }, [current?.review_item_id])

  const feedbackMutation = useMutation({
    mutationFn: () =>
      reviewApi.exerciseFeedback({
        review_item_id: current!.review_item_id,
        sentence_translation: exercise.data!.payload.sentence_translation,
        user_text: userText,
      }),
    onSuccess: (res) => setFeedback(res.feedback),
  })

  const next = () => setIdx((i) => i + 1)

  const restart = () => {
    setIdx(0)
    setUserText('')
    setFeedback(null)
    void queue.refetch()
  }

  if (queue.isPending) {
    return <SessionShell subtitle={subtitle}>{t('Загрузка…')}</SessionShell>
  }
  if (queue.isError) {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-destructive">{t('Не удалось загрузить очередь')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void queue.refetch()}>
          {t('Повторить')}
        </button>
      </SessionShell>
    )
  }
  if (total === 0) {
    if (lessonId) {
      return (
        <SessionShell subtitle={subtitle}>
          <LessonEmptyState lang={lang} />
        </SessionShell>
      )
    }
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">{t('Нет предложений для практики')}</p>
      </SessionShell>
    )
  }
  if (!current) {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">{t('Практика завершена')}</p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {t('Ещё раз')}
        </button>
      </SessionShell>
    )
  }

  return (
    <SessionShell subtitle={subtitle} idx={idx} total={total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        {exercise.isPending && (
          <p className="text-center text-sm text-muted-foreground">{t('Готовим предложение…')}</p>
        )}
        {exercise.isError && (
          <div className="text-center">
            <p className="text-sm text-destructive">{t('Не удалось сгенерировать упражнение')}</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                {t('Повторить')}
              </button>
              <button type="button" className="underline" onClick={next}>
                {t('Пропустить')}
              </button>
            </div>
          </div>
        )}
        {exercise.data && (
          <>
            <p className="text-center text-lg">{exercise.data.payload.sentence_translation}</p>
            {feedback === null ? (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('Переведите предложение на {{language}}.', {
                    language: t(
                      (
                        { en: 'английский', ru: 'русский', pt: 'португальский' } as Record<
                          string,
                          string
                        >
                      )[lang] ?? lang,
                    ),
                  })}
                </p>
                <textarea
                  aria-label={t('Ваш перевод')}
                  className="mt-4 w-full rounded-md border border-border p-2 text-sm"
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  rows={3}
                />
                {feedbackMutation.isError && (
                  <p className="mt-2 text-center text-sm text-destructive">
                    {t('Не удалось получить обратную связь')}
                  </p>
                )}
                <button
                  type="button"
                  className="mt-3 w-full rounded-md border border-border py-2 text-sm hover:bg-accent disabled:opacity-60"
                  disabled={feedbackMutation.isPending || userText.trim().length === 0}
                  onClick={() => feedbackMutation.mutate()}
                >
                  {t('Проверить')}
                </button>
              </>
            ) : (
              <>
                <p className="mt-4 text-center text-sm">{feedback}</p>
                <button type="button" className="mt-3 underline" onClick={next}>
                  {t('Дальше')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
