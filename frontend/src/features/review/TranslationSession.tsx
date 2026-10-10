import { exerciseErrorKey } from './exerciseError'
import { useI18n } from '@/lib/i18n'
import { learningLanguageLabel } from '@/lib/languages'
import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { reviewApi, type ReviewItemKind } from '@/api/review'
import { LessonEmptyState, SessionShell } from './sessionUi'
import { sessionSubtitle } from './sessionSubtitle'

const SUBTITLE = 'Практика перевода'

interface TranslationTaskExercise {
  sentence_translation: string
}

interface TranslationSessionProps {
  lang: string
  lessonId?: string
  itemKind?: ReviewItemKind
}

export function TranslationSession(props: TranslationSessionProps) {
  const { language } = useI18n()
  return (
    <TranslationSessionContent
      key={`${language}:${props.lang}:${props.lessonId ?? ''}:${props.itemKind ?? ''}`}
      {...props}
    />
  )
}

function TranslationSessionContent({ lang, lessonId, itemKind }: TranslationSessionProps) {
  const { language, t } = useI18n()
  const subtitle = sessionSubtitle(t, { title: SUBTITLE, lessonId, itemKind })

  const queue = useQuery({
    queryKey: ['review-queue', lang, 'practice', lessonId ?? null, itemKind ?? null, language],
    queryFn: () => reviewApi.queue(lang, lessonId, 'practice', itemKind),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const instance = useId()
  const [finished, setFinished] = useState(false)
  const [checkedCount, setCheckedCount] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [idx, setIdx] = useState(0)
  const [userText, setUserText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const items = queue.data?.items ?? []
  const total = items.length
  const current = finished ? undefined : items[idx]

  const exercise = useQuery({
    queryKey: ['exercise', instance, language, 'translation_task', current?.review_item_id ?? null],
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
    onSuccess: (res) => {
      setFeedback(res.feedback)
      setCheckedCount((value) => value + 1)
    },
  })

  const next = () => {
    if (feedbackMutation.isPending) return
    if (feedback === null) setSkipped((value) => value + 1)
    setIdx((i) => i + 1)
    feedbackMutation.reset()
  }

  const restart = () => {
    setIdx(0)
    setFinished(false)
    setCheckedCount(0)
    setSkipped(0)
    setUserText('')
    setFeedback(null)
    void queue.refetch()
  }

  if (queue.isPending) {
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Дополнительная практика — без изменения расписания.')}
      >
        {t('Загрузка…')}
      </SessionShell>
    )
  }
  if (queue.isError) {
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Дополнительная практика — без изменения расписания.')}
      >
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
        <SessionShell
          subtitle={subtitle}
          intro={t('Дополнительная практика — без изменения расписания.')}
        >
          <LessonEmptyState lang={lang} />
        </SessionShell>
      )
    }
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Дополнительная практика — без изменения расписания.')}
      >
        <p className="text-lg font-medium">{t('Нет предложений для практики')}</p>
      </SessionShell>
    )
  }
  if (!current) {
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Дополнительная практика — без изменения расписания.')}
      >
        <p className="text-lg font-medium">{t('Практика завершена')}</p>
        <p className="mt-3">
          {t('Попыток: {{count}} · Пропущено: {{skipped}} · Осталось: {{remaining}}', {
            count: checkedCount,
            skipped,
            remaining: total - checkedCount - skipped,
          })}
        </p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {t('Ещё раз')}
        </button>
      </SessionShell>
    )
  }

  return (
    <SessionShell
      subtitle={subtitle}
      intro={t('Дополнительная практика — без изменения расписания.')}
      idx={idx}
      total={total}
      finish={() => setFinished(true)}
      busy={feedbackMutation.isPending}
    >
      <div className="min-h-56 w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="mb-3 text-xs text-muted-foreground">{t('AI-пример')}</p>
        {exercise.isPending && (
          <p className="text-center text-sm text-muted-foreground">{t('Готовим предложение…')}</p>
        )}
        {exercise.isError && (
          <div className="text-center">
            <p className="text-sm text-destructive">{t(exerciseErrorKey(exercise.error))}</p>
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
                    language:
                      language === 'ru'
                        ? learningLanguageLabel(lang, language).toLocaleLowerCase('ru')
                        : learningLanguageLabel(lang, language),
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
                <p className="mt-4 text-xs text-muted-foreground">{t('AI-проверка')}</p>
                <p className="mt-1 text-center text-sm">{feedback}</p>
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
