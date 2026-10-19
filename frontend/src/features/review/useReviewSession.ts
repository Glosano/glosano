import { useI18n, msg } from '@/lib/i18n'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  reviewApi,
  type ReviewAnswerResponse,
  type ReviewDaily,
  type ReviewItemKind,
  type ReviewQueueItem,
} from '@/api/review'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'

export interface SessionAnswer {
  item: ReviewQueueItem
  quality: number
  response: ReviewAnswerResponse
}

export interface ReviewSessionResult {
  status: 'loading' | 'error' | 'empty' | 'limit' | 'active' | 'done'
  daily: ReviewDaily | undefined
  current: ReviewQueueItem | undefined
  idx: number
  total: number
  results: SessionAnswer[]
  skipped: number
  remaining: number
  retryRemaining: number
  selectionSize: number | undefined
  selectedIds: string[] | undefined
  sessionKey: string
  answering: boolean
  answerError: string | null
  graduated: boolean
  dismissGraduation: () => void
  grade: (quality: number) => void
  skip: () => void
  finish: () => void
  restart: () => void
  retryQueue: () => void
}

interface SessionState {
  items: ReviewQueueItem[]
  idx: number
  results: SessionAnswer[]
  skipped: number
  finished: boolean
}

export function useReviewSession(
  lang: string,
  opts: { serverMode: 'due' | 'new' | 'practice'; lessonId?: string; itemKind?: ReviewItemKind },
): ReviewSessionResult {
  const { language, t } = useI18n()
  const translationLanguage = useTranslationLanguage()
  const { serverMode, lessonId, itemKind } = opts
  const queryClient = useQueryClient()
  const instance = useId()
  const [round, setRound] = useState(0)
  const [selection, setSelection] = useState<string[] | null>(null)
  const [retryRemaining, setRetryRemaining] = useState<string[]>([])
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [
      'review-queue',
      lang,
      serverMode,
      lessonId ?? null,
      itemKind ?? null,
      language,
      translationLanguage,
      instance,
      round,
    ],
    queryFn: () =>
      selection
        ? reviewApi.selectedQueue(lang, selection, false, lessonId, itemKind)
        : reviewApi.queue(lang, lessonId, serverMode === 'due' ? undefined : serverMode, itemKind),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [session, setSession] = useState<SessionState | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [graduated, setGraduated] = useState(false)
  const answeringRef = useRef(false)
  const [doneToday, setDoneToday] = useState<number | null>(null)

  useEffect(() => {
    if (data && session === null && data.items.length > 0) {
      setSession({ items: data.items, idx: 0, results: [], skipped: 0, finished: false })
    }
  }, [data, session])

  const answerMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) => reviewApi.answer(id, quality),
    retry: false,
    onSuccess: async (res, { id, quality }) => {
      setAnswerError(null)
      setGraduated(res.new_status === 'known')
      setDoneToday(res.done_today)
      setSession((s) => {
        const current = s?.items[s.idx]
        if (!s || !current || current.review_item_id !== id) return s
        return {
          ...s,
          idx: s.idx + 1,
          results: [...s.results, { item: current, quality, response: res }],
        }
      })
      await invalidateVocabularyViews(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['review-counts'] })
    },
    onError: () => setAnswerError(msg('Could not save your answer')),
    onSettled: () => {
      answeringRef.current = false
    },
  })

  const current = session?.finished ? undefined : session?.items[session.idx]
  const { mutate: mutateAnswer } = answerMutation
  const grade = useCallback(
    (quality: number) => {
      if (
        !current ||
        answeringRef.current ||
        !Number.isInteger(quality) ||
        quality < 0 ||
        quality > 5
      )
        return
      answeringRef.current = true
      mutateAnswer({ id: current.review_item_id, quality })
    },
    [current, mutateAnswer],
  )

  const skip = useCallback(() => {
    if (answeringRef.current) return
    setAnswerError(null)
    setGraduated(false)
    setSession((s) =>
      !s || s.finished || s.idx >= s.items.length
        ? s
        : { ...s, idx: s.idx + 1, skipped: s.skipped + 1 },
    )
  }, [])
  const finish = useCallback(() => {
    if (!answeringRef.current) setSession((s) => (s ? { ...s, finished: true } : s))
  }, [])
  const restart = useCallback(() => {
    if (answeringRef.current) return
    const ids = [
      ...new Set([
        ...(session?.results.filter((r) => r.quality <= 2).map((r) => r.item.review_item_id) ?? []),
        ...retryRemaining,
      ]),
    ]
    if (!ids.length) return
    setSelection(ids.slice(0, 100))
    setRetryRemaining(ids.slice(100))
    setSession(null)
    setAnswerError(null)
    setGraduated(false)
    setDoneToday(null)
    setRound((value) => value + 1)
  }, [session, retryRemaining])

  let status: ReviewSessionResult['status']
  if (isPending) status = 'loading'
  else if (isError || !data) status = 'error'
  else if (!session)
    status = data.items.length ? 'loading' : data.daily.limit_reached ? 'limit' : 'empty'
  else status = current ? 'active' : 'done'

  return {
    status,
    daily: data ? { ...data.daily, done_today: doneToday ?? data.daily.done_today } : undefined,
    current,
    idx: session?.idx ?? 0,
    total: session?.items.length ?? 0,
    results: session?.results ?? [],
    skipped: session?.skipped ?? 0,
    remaining: session ? session.items.length - session.idx : 0,
    retryRemaining: retryRemaining.length,
    selectionSize: selection?.length,
    selectedIds: selection ?? undefined,
    sessionKey: `${instance}:${round}`,
    answering: answerMutation.isPending,
    answerError: answerError ? t(answerError) : null,
    graduated,
    dismissGraduation: useCallback(() => setGraduated(false), []),
    grade,
    skip,
    finish,
    restart,
    retryQueue: useCallback(() => {
      void refetch()
    }, [refetch]),
  }
}
