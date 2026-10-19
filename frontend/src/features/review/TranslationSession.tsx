import { exerciseErrorKey } from './exerciseError'
import { useI18n, msg } from '@/lib/i18n'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { learningLanguageLabel } from '@/lib/languages'
import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { reviewApi, type ReviewItemKind } from '@/api/review'
import { LessonEmptyState, SessionShell } from './sessionUi'
import { sessionSubtitle } from './sessionSubtitle'

const SUBTITLE = msg('Translation practice')

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
  const translationLanguage = useTranslationLanguage()
  return (
    <TranslationSessionContent
      key={`${language}:${translationLanguage}:${props.lang}:${props.lessonId ?? ''}:${props.itemKind ?? ''}`}
      {...props}
    />
  )
}

function TranslationSessionContent({ lang, lessonId, itemKind }: TranslationSessionProps) {
  const { language, t } = useI18n()
  const translationLanguage = useTranslationLanguage()
  const subtitle = sessionSubtitle(t, { title: SUBTITLE, lessonId, itemKind })

  const queue = useQuery({
    queryKey: [
      'review-queue',
      lang,
      'practice',
      lessonId ?? null,
      itemKind ?? null,
      language,
      translationLanguage,
    ],
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
    queryKey: [
      'exercise',
      instance,
      language,
      translationLanguage,
      'translation_task',
      current?.review_item_id ?? null,
    ],
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
        intro={t('Extra practice — your review schedule stays the same.')}
      >
        {t('Loading…')}
      </SessionShell>
    )
  }
  if (queue.isError) {
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Extra practice — your review schedule stays the same.')}
      >
        <p className="text-destructive">{t('Could not load the review queue')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void queue.refetch()}>
          {t('Retry')}
        </button>
      </SessionShell>
    )
  }
  if (total === 0) {
    if (lessonId) {
      return (
        <SessionShell
          subtitle={subtitle}
          intro={t('Extra practice — your review schedule stays the same.')}
        >
          <LessonEmptyState lang={lang} />
        </SessionShell>
      )
    }
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Extra practice — your review schedule stays the same.')}
      >
        <p className="text-lg font-medium">{t('No sentences available to practice')}</p>
      </SessionShell>
    )
  }
  if (!current) {
    return (
      <SessionShell
        subtitle={subtitle}
        intro={t('Extra practice — your review schedule stays the same.')}
      >
        <p className="text-lg font-medium">{t('Practice complete')}</p>
        <p className="mt-3">
          {t('Attempts: {{count}} · Skipped: {{skipped}} · Remaining: {{remaining}}', {
            count: String(checkedCount),
            skipped,
            remaining: total - checkedCount - skipped,
          })}
        </p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {t('Try again', { context: 'review' })}
        </button>
      </SessionShell>
    )
  }

  return (
    <SessionShell
      subtitle={subtitle}
      intro={t('Extra practice — your review schedule stays the same.')}
      idx={idx}
      total={total}
      finish={() => setFinished(true)}
      busy={feedbackMutation.isPending}
    >
      <div className="min-h-56 w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="mb-3 text-xs text-muted-foreground">{t('AI-generated example')}</p>
        {exercise.isPending && (
          <p className="text-center text-sm text-muted-foreground">{t('Preparing a sentence…')}</p>
        )}
        {exercise.isError && (
          <div className="text-center">
            <p className="text-sm text-destructive">{t(exerciseErrorKey(exercise.error))}</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                {t('Retry')}
              </button>
              <button type="button" className="underline" onClick={next}>
                {t('Skip')}
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
                  {t('Translate the sentence into: {{language}}.', {
                    language: learningLanguageLabel(lang, language),
                  })}
                </p>
                <textarea
                  aria-label={t('Your translation')}
                  className="mt-4 w-full rounded-md border border-border p-2 text-sm"
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  rows={3}
                />
                {feedbackMutation.isError && (
                  <p className="mt-2 text-center text-sm text-destructive">
                    {t('Could not get feedback')}
                  </p>
                )}
                <button
                  type="button"
                  className="mt-3 w-full rounded-md border border-border py-2 text-sm hover:bg-accent disabled:opacity-60"
                  disabled={feedbackMutation.isPending || userText.trim().length === 0}
                  onClick={() => feedbackMutation.mutate()}
                >
                  {t('Check answer', { context: 'review' })}
                </button>
              </>
            ) : (
              <>
                <p className="mt-4 text-xs text-muted-foreground">{t('AI feedback')}</p>
                <p className="mt-1 text-center text-sm">{feedback}</p>
                <button type="button" className="mt-3 underline" onClick={next}>
                  {t('Next', { context: 'review' })}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
