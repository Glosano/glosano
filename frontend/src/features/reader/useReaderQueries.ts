import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { lessonsApi, type LessonDetail } from '@/api/lessons'
import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'

export function useLessonDetail(lessonId: string) {
  return useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => lessonsApi.get(lessonId),
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 2000 : false),
  })
}

export function useLessonContent(lessonId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['reader-content', lessonId],
    queryFn: () => readerApi.content(lessonId),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled,
  })
}

export function useTokenStatuses(lessonId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['reader-statuses', lessonId],
    queryFn: () => readerApi.statuses(lessonId),
    enabled,
  })
}

export function useLessonVocabulary(lessonId: string, target: string, enabled: boolean) {
  return useQuery({
    queryKey: ['reader-vocabulary', lessonId, target],
    queryFn: () => readerApi.vocabulary(lessonId, target),
    enabled,
  })
}

// The library list card (['lessons', lang]) shows a read-percent and a
// new-words-remaining count derived from exactly the writes below (reader
// position, bulk-known, undo). Nothing else invalidates that query, and its
// staleTime is 30s (main.tsx) — without invalidating here, a user who reads
// for under 30s and bounces back to the library sees stale numbers. This is
// invalidated from each mutation's own onSuccess (not e.g. on reader unmount)
// so the refresh is ordered after the write it depends on has landed, rather
// than racing the debounced position PUT.
export function usePutPosition(lang: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: readerApi.putPosition,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
    },
  })
}

export function useBulkKnown(lessonId: string, lang: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: readerApi.bulkKnown,
    onSuccess: () =>
      Promise.all([
        invalidateVocabularyViews(queryClient),
        queryClient.invalidateQueries({ queryKey: ['reader-statuses', lessonId] }),
        queryClient.invalidateQueries({ queryKey: ['lessons', lang] }),
      ]).then(() => undefined),
  })
}

export function useCompleteLesson(_lessonId: string, lang: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: readerApi.complete,
    onMutate: () => ({ lang }),
    onSuccess: async (result, body, context) => {
      const lessonId = body.lesson_id
      queryClient.setQueryData(['completion-summary', lessonId, result.action_id], result)
      await queryClient.cancelQueries({ queryKey: ['lesson', lessonId] })
      queryClient.setQueryData<LessonDetail>(['lesson', lessonId], (old) =>
        old
          ? {
              ...old,
              reader_position: {
                view_mode: body.view_mode,
                current_segment_id: body.last_segment_id,
                current_token_ordinal: body.to_ordinal,
                completed_at: result.completed_at,
                completion_action_id: result.action_id,
              },
            }
          : old,
      )
      return Promise.all([
        invalidateVocabularyViews(queryClient),
        queryClient.invalidateQueries({ queryKey: ['reader-statuses', lessonId] }),
        queryClient.invalidateQueries({ queryKey: ['lessons', context?.lang ?? lang] }),
      ]).then(() => undefined)
    },
  })
}

export function useUndoBulk(lessonId: string, lang: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: string) => {
      try {
        return await readerApi.undoBulk(actionId)
      } catch (error) {
        // The write may have succeeded even when its response was lost.
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.detail === 'already_undone'
        ) {
          return { undone_count: 0, reconcile: true }
        }
        throw error
      }
    },
    onMutate: () => ({ lessonId, lang }),
    onSuccess: async (result, actionId, context) => {
      const targetLessonId = context?.lessonId ?? lessonId
      await queryClient.cancelQueries({ queryKey: ['lesson', targetLessonId] })
      if ('reconcile' in result) {
        await queryClient.fetchQuery({
          queryKey: ['lesson', targetLessonId],
          queryFn: () => lessonsApi.get(targetLessonId),
          staleTime: 0,
        })
      } else
        queryClient.setQueryData<LessonDetail>(['lesson', targetLessonId], (old) =>
          old?.reader_position?.completion_action_id === actionId
            ? {
                ...old,
                reader_position: {
                  ...old.reader_position,
                  completed_at: null,
                  completion_action_id: null,
                },
              }
            : old,
        )
      return Promise.all([
        invalidateVocabularyViews(queryClient),
        queryClient.invalidateQueries({ queryKey: ['reader-statuses', targetLessonId] }),
        queryClient.invalidateQueries({ queryKey: ['lessons', context?.lang ?? lang] }),
      ]).then(() => undefined)
    },
  })
}

export function usePhrases(lang: string, enabled: boolean) {
  return useQuery({
    queryKey: ['phrases', lang],
    queryFn: () => vocabularyApi.phrases(lang),
    enabled,
  })
}

export function useSegmentTranslation(
  lessonId: string,
  segId: string,
  target: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['segment-translation', segId, target],
    queryFn: () => readerApi.segmentTranslation(lessonId, segId, target),
    staleTime: Infinity,
    enabled,
  })
}
