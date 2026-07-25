import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { reviewApi, type ExampleExercise } from '@/api/review'
import { GradeBar } from './GradeBar'
import { useReviewSession } from './useReviewSession'
import { SessionShell, SessionStates } from './sessionUi'

export function NewWordsSession({ lang, lessonId }: { lang: string; lessonId?: string }) {
  const s = useReviewSession(lang, { serverMode: 'new', lessonId })
  const [revealed, setRevealed] = useState(false)

  const exercise = useQuery({
    queryKey: ['exercise', 'example', s.current?.review_item_id ?? null],
    queryFn: () =>
      reviewApi.exercise<ExampleExercise>({
        kind: 'example',
        review_item_id: s.current!.review_item_id,
      }),
    enabled: s.current !== undefined,
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => setRevealed(false), [s.current?.review_item_id])

  // хоткеи: Space — раскрыть; 0..5 — оценка после раскрытия
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!s.current || !exercise.data) return
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && /^[0-5]$/.test(e.key)) {
        s.grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const subtitle = lessonId ? 'Новые слова · Слова урока' : 'Новые слова'

  const states = SessionStates(s, subtitle)
  if (states) return states
  const item = s.current!

  return (
    <SessionShell subtitle={subtitle} idx={s.idx} total={s.total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-center text-2xl font-medium">{item.text}</p>
        {exercise.isPending && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Готовим пример…</p>
        )}
        {exercise.isError && (
          <div className="mt-4 text-center">
            <p className="text-sm text-destructive">Не удалось сгенерировать упражнение</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                Повторить
              </button>
              <button type="button" className="underline" onClick={s.skip}>
                Пропустить
              </button>
            </div>
          </div>
        )}
        {exercise.data && (
          <>
            <p className="mt-3 text-center text-base">{exercise.data.payload.sentence}</p>
            {!revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-6 w-full rounded-md border border-border py-3 text-sm hover:bg-accent"
              >
                Показать перевод
              </button>
            ) : (
              <>
                <hr className="my-4 border-border" />
                {item.translation && <p className="text-center text-xl">{item.translation}</p>}
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {exercise.data.payload.base_form} → {exercise.data.payload.base_form_translation}
                </p>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  {exercise.data.payload.sentence_translation}
                </p>
                {s.answerError && (
                  <p className="mt-2 text-center text-sm text-destructive">{s.answerError}</p>
                )}
                <GradeBar onGrade={s.grade} disabled={s.answering} />
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
