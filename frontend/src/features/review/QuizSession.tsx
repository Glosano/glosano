import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { reviewApi, type ClozeExercise, type ReverseExercise } from '@/api/review'
import { GradeBar } from './GradeBar'
import { SessionShell, SessionStates } from './sessionUi'
import { useReviewSession } from './useReviewSession'

type QuizKind = 'cloze' | 'reverse'
type QuizPayload = ClozeExercise | ReverseExercise

const SUBTITLES: Record<QuizKind, string> = {
  cloze: 'Квиз: пропуск',
  reverse: 'Квиз: перевод',
}

export function QuizSession({
  lang,
  kind,
  lessonId,
}: {
  lang: string
  kind: QuizKind
  lessonId?: string
}) {
  const s = useReviewSession(lang, { serverMode: 'due', lessonId })
  const [picked, setPicked] = useState<number | null>(null)

  const exercise = useQuery({
    queryKey: ['exercise', kind, s.current?.review_item_id ?? null],
    queryFn: () =>
      reviewApi.exercise<QuizPayload>({ kind, review_item_id: s.current!.review_item_id }),
    enabled: s.current !== undefined,
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => setPicked(null), [s.current?.review_item_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!s.current || !exercise.data) return
      if (picked === null && /^[1-4]$/.test(e.key)) {
        setPicked(Number(e.key) - 1)
      } else if (picked !== null && /^[0-5]$/.test(e.key)) {
        s.grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const subtitle = lessonId ? `${SUBTITLES[kind]} · Слова урока` : SUBTITLES[kind]

  const states = SessionStates(s, subtitle, { showWriting: true })
  if (states) return states
  const item = s.current!
  const payload = exercise.data?.payload
  const options = payload?.options ?? []
  const correctIdx = options.findIndex((o) => o.is_correct)
  const isCorrect = picked !== null && options[picked]?.is_correct

  return (
    <SessionShell subtitle={subtitle} idx={s.idx} total={s.total}>
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        {kind === 'reverse' && <p className="text-center text-2xl font-medium">{item.text}</p>}
        {exercise.isPending && (
          <p className="mt-4 text-center text-sm text-muted-foreground">Готовим упражнение…</p>
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
        {payload && (
          <>
            {'sentence_with_gap' in payload ? (
              <>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {payload.sentence_translation}
                </p>
                <p className="mt-3 text-center text-lg">{payload.sentence_with_gap}</p>
              </>
            ) : (
              <p className="mt-3 text-center text-sm text-muted-foreground">{payload.sentence}</p>
            )}
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {options.map((o, i) => (
                <button
                  key={o.text}
                  type="button"
                  disabled={picked !== null}
                  onClick={() => setPicked(i)}
                  className={[
                    'rounded-md border py-3 text-base disabled:opacity-80',
                    picked === null && 'border-border hover:bg-accent',
                    picked !== null && o.is_correct && 'border-green-600',
                    picked === i && !o.is_correct && 'border-destructive',
                    picked !== null && picked !== i && !o.is_correct && 'border-border opacity-50',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {o.text}
                </button>
              ))}
            </div>
            {picked !== null && (
              <>
                <p className="mt-4 text-center text-base">
                  {isCorrect ? '✅ Верно!' : `❌ Правильный ответ: ${options[correctIdx]?.text}`}
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
