import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { reviewApi, type ReviewQueueItem } from '@/api/review'
import { ReviewCard } from './ReviewCard'

interface Props {
  lang: string
  lessonId: string | undefined
}

interface SessionState {
  items: ReviewQueueItem[]
  idx: number
  correct: number
  wrong: number
}

export function ReviewPage({ lang, lessonId }: Props) {
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['review-queue', lang, lessonId ?? null],
    queryFn: () => reviewApi.queue(lang, lessonId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  // Сессия — локальный снапшот очереди: рефетчи посреди сессии её не трогают.
  const [session, setSession] = useState<SessionState | null>(null)
  // Отслеживаем момент последнего сидирования, чтобы restart() не пересеял сессию
  // тем же устаревшим data, пока идёт refetch (TanStack хранит старые данные in-flight).
  const seededAtRef = useRef(0)

  useEffect(() => {
    if (data && session === null && data.items.length > 0 && dataUpdatedAt > seededAtRef.current) {
      seededAtRef.current = dataUpdatedAt
      setSession({ items: data.items, idx: 0, correct: 0, wrong: 0 })
    }
  }, [data, dataUpdatedAt, session])

  const restart = () => {
    setSession(null)
    // Устаревший graduation-тост от прошлой сессии не должен всплыть на первой
    // карточке новой — сбрасываем явно, а не полагаемся на следующий ответ.
    setShowGraduationToast(false)
    // Подсветка/списки могли устареть после ответов — сбрасываем перед новой очередью.
    void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
    void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
    void queryClient.invalidateQueries({ queryKey: ['phrases'] })
    void refetch()
  }

  const [flipped, setFlipped] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)
  // Graduation-тост (spec §6): показываем при new_status === 'known', сбрасываем
  // на следующем ответе (пересчитывается в onSuccess) либо по авто-таймеру.
  const [showGraduationToast, setShowGraduationToast] = useState(false)

  const answerMutation = useMutation({
    mutationFn: ({ id, a }: { id: string; a: 'correct' | 'wrong' }) => {
      // Shim: convert old API (correct/wrong) to new quality-based API (0..5)
      const quality = a === 'correct' ? 4 : 2
      return reviewApi.answer(id, quality)
    },
    onSuccess: (res, { a }) => {
      setAnswerError(null)
      setFlipped(false)
      setShowGraduationToast(res.new_status === 'known')
      setSession((s) => {
        if (s === null) return s
        return {
          ...s,
          idx: s.idx + 1,
          correct: s.correct + (a === 'correct' ? 1 : 0),
          wrong: s.wrong + (a === 'wrong' ? 1 : 0),
        }
      })
    },
    onError: () => setAnswerError('Не удалось сохранить ответ'),
  })

  // Сессия завершена: подсветка reader и списки словаря должны подтянуть
  // новые confidence/status (spec §6). Держим инвалидацию вне setSession —
  // апдейтер должен оставаться чистым (StrictMode/concurrent re-invocation).
  useEffect(() => {
    if (session && session.idx >= session.items.length) {
      void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
      void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
      void queryClient.invalidateQueries({ queryKey: ['phrases'] })
    }
  }, [session, queryClient])

  const current = session?.items[session.idx]

  const handleAnswer = useCallback(
    (a: 'correct' | 'wrong') => {
      if (!current || answerMutation.isPending) return
      answerMutation.mutate({ id: current.review_item_id, a })
    },
    [current, answerMutation],
  )

  // хоткеи: Space — flip, 1 — ошибка, 2 — знаю (после переворота)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (e.key === ' ') {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && e.key === '1') {
        handleAnswer('wrong')
      } else if (flipped && e.key === '2') {
        handleAnswer('correct')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, flipped, handleAnswer])

  if (isPending) {
    return <Shell lessonId={lessonId}>Загрузка…</Shell>
  }
  if (isError) {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-destructive">Не удалось загрузить очередь</p>
        <button type="button" className="mt-2 underline" onClick={() => void refetch()}>
          Повторить
        </button>
      </Shell>
    )
  }
  if (session === null) {
    if (data.daily.limit_reached) {
      return (
        <Shell lessonId={lessonId}>
          <p className="text-lg font-medium">Дневной лимит достигнут</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Сегодня: {data.daily.done_today} / {data.daily.limit}. Возвращайтесь завтра!
          </p>
        </Shell>
      )
    }
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Всё повторено</p>
        <p className="mt-1 text-sm text-muted-foreground">Нет карточек к повторению.</p>
      </Shell>
    )
  }

  if (!current) {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Сессия завершена</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Верно: {session.correct} · Ошибки: {session.wrong}
        </p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {lessonId ? 'Пройти ещё раз' : 'Повторить ошибки'}
        </button>
        {showGraduationToast && (
          <GraduationToast onDismiss={() => setShowGraduationToast(false)} />
        )}
      </Shell>
    )
  }

  return (
    <Shell lessonId={lessonId}>
      <p className="mb-4 text-sm text-muted-foreground">
        {session.idx + 1} / {session.items.length}
      </p>
      <ReviewCard
        item={current}
        flipped={flipped}
        answering={answerMutation.isPending}
        error={answerError}
        onFlip={() => setFlipped(true)}
        onAnswer={handleAnswer}
      />
      {showGraduationToast && <GraduationToast onDismiss={() => setShowGraduationToast(false)} />}
    </Shell>
  )
}

const GRADUATION_TOAST_MS = 3000

function GraduationToast({ onDismiss }: { onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  // Тот же паттерн, что UndoToast: таймер взводится один раз при монтировании.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), GRADUATION_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      data-testid="graduation-toast"
      className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
    >
      <div className="rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg">
        Слово выучено ✓
      </div>
    </div>
  )
}

function Shell({ lessonId, children }: { lessonId: string | undefined; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-1 text-xl font-semibold">Повторение</h1>
      {lessonId && <p className="mb-4 text-sm text-muted-foreground">Слова урока</p>}
      {children}
    </div>
  )
}
