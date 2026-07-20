import { createRoute, useParams, useSearch } from '@tanstack/react-router'

import { ReviewPage } from '@/features/review/ReviewPage'

import { learnLangRoute } from './learn.$lang'

export const learnReviewRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'review',
  validateSearch: (search: Record<string, unknown>): { lessonId?: string } =>
    typeof search.lessonId === 'string' && search.lessonId ? { lessonId: search.lessonId } : {},
  component: function ReviewView() {
    const params = useParams({ from: '/learn/$lang/review' })
    const { lessonId } = useSearch({ from: '/learn/$lang/review' })
    return <ReviewPage lang={params.lang} lessonId={lessonId} />
  },
})
