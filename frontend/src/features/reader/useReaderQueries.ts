import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { lessonsApi } from '@/api/lessons'
import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reader-statuses', lessonId] })
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
    },
  })
}

export function useUndoBulk(lessonId: string, lang: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: readerApi.undoBulk,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reader-statuses', lessonId] })
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
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
