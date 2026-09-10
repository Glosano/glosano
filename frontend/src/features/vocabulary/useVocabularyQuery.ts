import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { vocabularyApi } from '@/api/vocabulary'
import type { ItemKind, VocabListParams } from '@/api/vocabulary'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'

export const VOCAB_TARGET = 'ru'

export function vocabListKey(params: VocabListParams) {
  return ['vocab-list', params] as const
}

export function useVocabList(params: VocabListParams, enabled = true) {
  return useQuery({
    queryKey: vocabListKey(params),
    queryFn: () => vocabularyApi.list(params),
    enabled,
    placeholderData: (prev) => prev,
  })
}

export function useVocabInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['vocab-list'] })
}

export function useBulkAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vocabularyApi.bulk,
    onSuccess: () => invalidateVocabularyViews(qc),
  })
}

export function usePatchItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: {
      itemId: string
      kind: ItemKind
      status: 'tracked' | 'known' | 'ignored'
      confidence: number | null
    }) => vocabularyApi.patchItem(v.kind, v.itemId, { status: v.status, confidence: v.confidence }),
    onSuccess: () => invalidateVocabularyViews(qc),
  })
}
