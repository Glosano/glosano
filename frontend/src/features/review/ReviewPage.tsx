import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { reviewApi, type ReviewQueueItem } from '@/api/review'

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
    // Подсветка/списки могли устареть после ответов — сбрасываем перед новой очередью.
    void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
    void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
    void refetch()
  }

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

  const current = session.items[session.idx]
  if (!current) {
    // Финальный экран — дополняется в Task 9 (кнопка «Повторить ошибки»).
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Сессия завершена</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Верно: {session.correct} · Ошибки: {session.wrong}
        </p>
        <button type="button" className="mt-3 underline" onClick={restart}>
          {lessonId ? 'Пройти ещё раз' : 'Повторить ошибки'}
        </button>
      </Shell>
    )
  }

  return (
    <Shell lessonId={lessonId}>
      <p className="mb-4 text-sm text-muted-foreground">
        {session.idx + 1} / {session.items.length}
      </p>
      {/* Task 9 заменяет этот блок на <ReviewCard …> */}
      <p className="text-2xl">{current.text}</p>
    </Shell>
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
