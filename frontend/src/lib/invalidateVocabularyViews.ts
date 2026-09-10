import type { QueryClient } from '@tanstack/react-query'

export async function invalidateVocabularyViews(qc: QueryClient): Promise<void> {
  const prefixes = [
    'reader-vocabulary',
    'reader-statuses',
    'word-card',
    'phrases',
    'vocab-list',
    'lessons',
    'review-counts',
  ]

  await Promise.all(prefixes.map((prefix) => qc.invalidateQueries({ queryKey: [prefix] })))
}
