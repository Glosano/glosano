import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { reviewApi } from '@/api/review'
import { SessionShell } from './sessionUi'

const SUBTITLE = 'Практика перевода'

interface TranslationTaskExercise {
  sentence_translation: string
}

export function TranslationSession({ lang, lessonId }: { lang: string; lessonId?: string }) {
  const subtitle = lessonId ? `${SUBTITLE} · Слова урока` : SUBTITLE

  const queue = useQuery({
    queryKey: ['review-queue', lang, 'practice', lessonId ?? null],
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
    queryKey: ['exercise', 'translation_task', current?.review_item_id ?? null],
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
    return <SessionShell subtitle={subtitle}>Загрузка…</SessionShell>
  }
  if (queue.isError) {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-destructive">Не удалось загрузить очередь</p>
        <button type="button" className="mt-2 underline" onClick={() => void queue.refetch()}>
          Повторить
        </button>
      </SessionShell>
    )
  }
  if (total === 0) {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">Нет предложений для практики</p>
      </SessionShell>
    )
  }
  if (!current) {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">Практика завершена</p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          Ещё раз
        </button>
      </SessionShell>
    )
  }

  return (
    <SessionShell subtitle={subtitle} idx={idx} total={total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        {exercise.isPending && (
          <p className="text-center text-sm text-muted-foreground">Готовим предложение…</p>
        )}
        {exercise.isError && (
          <div className="text-center">
            <p className="text-sm text-destructive">Не удалось сгенерировать упражнение</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                Повторить
              </button>
              <button type="button" className="underline" onClick={next}>
                Пропустить
              </button>
            </div>
          </div>
        )}
        {exercise.data && (
          <>
            <p className="text-center text-lg">{exercise.data.payload.sentence_translation}</p>
            {feedback === null ? (
              <>
                <textarea
                  className="mt-4 w-full rounded-md border border-border p-2 text-sm"
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  rows={3}
                />
                {feedbackMutation.isError && (
                  <p className="mt-2 text-center text-sm text-destructive">
                    Не удалось получить обратную связь
                  </p>
                )}
                <button
                  type="button"
                  className="mt-3 w-full rounded-md border border-border py-2 text-sm hover:bg-accent disabled:opacity-60"
                  disabled={feedbackMutation.isPending || userText.trim().length === 0}
                  onClick={() => feedbackMutation.mutate()}
                >
                  Проверить
                </button>
              </>
            ) : (
              <>
                <p className="mt-4 text-center text-sm">{feedback}</p>
                <button type="button" className="mt-3 underline" onClick={next}>
                  Дальше
                </button>
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
