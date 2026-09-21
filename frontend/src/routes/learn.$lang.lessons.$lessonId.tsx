import { createRoute, useParams } from '@tanstack/react-router'

import { ReaderPage } from '@/features/reader/ReaderPage'

import { learnLangRoute } from './learn.$lang'

export const learnLessonRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'lessons/$lessonId',
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    sourceVersion?: number
    ordinal?: number
    paragraphIndex?: number
    sourceRequest?: string
  } => {
    const version = Number(search.sourceVersion),
      ordinal = Number(search.ordinal),
      paragraphIndex = Number(search.paragraphIndex)
    return Number.isInteger(version) && version >= 1 && Number.isInteger(ordinal) && ordinal >= 0
      ? {
          sourceVersion: version,
          ordinal,
          paragraphIndex:
            Number.isInteger(paragraphIndex) && paragraphIndex >= 0 ? paragraphIndex : undefined,
          sourceRequest:
            typeof search.sourceRequest === 'string'
              ? search.sourceRequest.slice(0, 80)
              : undefined,
        }
      : {}
  },
  component: function LessonReaderView() {
    const params = useParams({ from: '/learn/$lang/lessons/$lessonId' })
    const search = learnLessonRoute.useSearch()
    return (
      <ReaderPage
        lang={params.lang}
        lessonId={params.lessonId}
        sourcePosition={
          search.sourceVersion != null && search.ordinal != null
            ? {
                sourceVersion: search.sourceVersion,
                ordinal: search.ordinal,
                paragraphIndex: search.paragraphIndex,
                requestId: search.sourceRequest,
              }
            : undefined
        }
      />
    )
  },
})
