import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'

import { invalidateVocabularyViews } from './invalidateVocabularyViews'

it('marks all cached lesson vocabularies stale across lessons and targets', async () => {
  const qc = new QueryClient()
  const keys = [
    ['reader-vocabulary', 'lesson-1', 'ru'],
    ['reader-vocabulary', 'lesson-1', 'en'],
    ['reader-vocabulary', 'lesson-2', 'ru'],
  ]
  keys.forEach((key) => qc.setQueryData(key, { items: [] }))
  qc.setQueryData(['reader-content', 'lesson-1'], { paragraphs: [] })

  await invalidateVocabularyViews(qc)

  keys.forEach((key) => expect(qc.getQueryState(key)?.isInvalidated).toBe(true))
  expect(qc.getQueryState(['reader-content', 'lesson-1'])?.isInvalidated).toBe(false)
})

it('invalidates every vocabulary consumer while preserving unrelated reader caches', async () => {
  const qc = new QueryClient()
  const vocabularyKeys = [
    ['reader-statuses', 'lesson-1'],
    ['word-card', 'token', 'pt', 'casa', 'ru'],
    ['phrases', 'pt'],
    ['vocab-list', { lang: 'pt' }],
    ['lessons', 'pt'],
    ['review-counts', 'pt', null],
    ['stats', 'pt', '2026-09-10'],
    ['stats', 'ru', '2026-09-10'],
  ]
  const preservedKeys = [
    ['reader-content', 'lesson-1'],
    ['reader-position', 'lesson-1'],
    ['segment-translation', 'segment-1', 'ru'],
  ]
  vocabularyKeys.forEach((key) => qc.setQueryData(key, {}))
  preservedKeys.forEach((key) => qc.setQueryData(key, {}))

  await invalidateVocabularyViews(qc)

  vocabularyKeys.forEach((key) => expect(qc.getQueryState(key)?.isInvalidated).toBe(true))
  preservedKeys.forEach((key) => expect(qc.getQueryState(key)?.isInvalidated).toBe(false))
})
