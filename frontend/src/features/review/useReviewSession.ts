import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { reviewApi, type ReviewDaily, type ReviewQueueItem } from '@/api/review'

export interface ReviewSessionResult {
  status: 'loading' | 'error' | 'empty' | 'limit' | 'active' | 'done'
  daily: ReviewDaily | undefined
  current: ReviewQueueItem | undefined
  idx: number
  total: number
  results: { item: ReviewQueueItem; quality: number }[] // накопленные ответы сессии
  answering: boolean
  answerError: string | null
  graduated: boolean // показать тост
  dismissGraduation: () => void
  grade: (quality: number) => void // POST answer + переход к следующей
  skip: () => void // пропустить карточку БЕЗ события
  restart: () => void
  retryQueue: () => void
}

interface SessionState {
  items: ReviewQueueItem[]
  idx: number
  results: { item: ReviewQueueItem; quality: number }[]
}

export function useReviewSession(
  lang: string,
  opts: { serverMode: 'due' | 'new' | 'practice'; lessonId?: string },
): ReviewSessionResult {
  const { serverMode, lessonId } = opts
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['review-queue', lang, serverMode, lessonId ?? null],
    queryFn: () => reviewApi.queue(lang, lessonId, serverMode === 'due' ? undefined : serverMode),
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
      setSession({ items: data.items, idx: 0, results: [] })
    }
  }, [data, dataUpdatedAt, session])

  const [answerError, setAnswerError] = useState<string | null>(null)
  // Graduation-тост (spec §6): показываем при new_status === 'known', сбрасываем
  // на следующем ответе (пересчитывается в onSuccess) либо по авто-таймеру.
  const [graduated, setGraduated] = useState(false)

  const restart = useCallback(() => {
    setSession(null)
    // Устаревший graduation-тост от прошлой сессии не должен всплыть на первой
    // карточке новой — сбрасываем явно, а не полагаемся на следующий ответ.
    setGraduated(false)
    // Подсветка/списки могли устареть после ответов — сбрасываем перед новой очередью.
    void queryClient.invalidateQueries({ queryKey: ['reader-statuses'] })
    void queryClient.invalidateQueries({ queryKey: ['vocab-list'] })
    void queryClient.invalidateQueries({ queryKey: ['phrases'] })
    void refetch()
  }, [queryClient, refetch])

  const answerMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) => reviewApi.answer(id, quality),
    onSuccess: (res, { quality }) => {
      setAnswerError(null)
      setGraduated(res.new_status === 'known')
      setSession((s) => {
        if (s === null) return s
        const current = s.items[s.idx]
        if (!current) return s
        return {
          ...s,
          idx: s.idx + 1,
          results: [...s.results, { item: current, quality }],
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
  const { isPending: isAnswering, mutate: mutateAnswer } = answerMutation

  const grade = useCallback(
    (quality: number) => {
      if (!current || isAnswering) return
      mutateAnswer({ id: current.review_item_id, quality })
    },
    [current, isAnswering, mutateAnswer],
  )

  const skip = useCallback(() => {
    setSession((s) => {
      if (s === null) return s
      return { ...s, idx: s.idx + 1 }
    })
  }, [])

  let status: ReviewSessionResult['status']
  if (isPending) {
    status = 'loading'
  } else if (isError || !data) {
    status = 'error'
  } else if (session === null) {
    // Между разрешением запроса (isPending=false) и проходом passive-эффекта,
    // который сидирует session, есть транзитный рендер: данные уже есть, а
    // session ещё null. Если очередь непустая, это не 'empty' — просто кадр
    // до сидирования; статус 'loading' точнее и не должен доезжать до UI как
    // «нет карточек».
    status = data.items.length > 0 ? 'loading' : data.daily.limit_reached ? 'limit' : 'empty'
  } else if (current) {
    status = 'active'
  } else {
    status = 'done'
  }

  const dismissGraduation = useCallback(() => setGraduated(false), [])
  const retryQueue = useCallback(() => void refetch(), [refetch])

  return {
    status,
    daily: data?.daily,
    current,
    idx: session?.idx ?? 0,
    total: session?.items.length ?? 0,
    results: session?.results ?? [],
    answering: answerMutation.isPending,
    answerError,
    graduated,
    dismissGraduation,
    grade,
    skip,
    restart,
    retryQueue,
  }
}
