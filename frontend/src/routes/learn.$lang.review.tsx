import { createRoute, useParams, useSearch } from '@tanstack/react-router'

import type { ReviewMode } from '@/api/review'
import { ReviewPage } from '@/features/review/ReviewPage'

import { learnLangRoute } from './learn.$lang'

const MODES = ['cards', 'new', 'cloze', 'reverse', 'translation'] as const

export const learnReviewRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'review',
  validateSearch: (search: Record<string, unknown>): { lessonId?: string; mode?: ReviewMode } => ({
    ...(typeof search.lessonId === 'string' && search.lessonId
      ? { lessonId: search.lessonId }
      : {}),
    ...(MODES.includes(search.mode as ReviewMode) ? { mode: search.mode as ReviewMode } : {}),
  }),
  component: function ReviewView() {
    const params = useParams({ from: '/learn/$lang/review' })
    const { lessonId, mode } = useSearch({ from: '/learn/$lang/review' })
    return <ReviewPage lang={params.lang} lessonId={lessonId} mode={mode} />
  },
})
