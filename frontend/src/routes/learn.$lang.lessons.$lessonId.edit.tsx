import { createRoute, useNavigate } from '@tanstack/react-router'

import { EditLessonPage } from '@/features/library/EditLessonPage'
import { learnLangRoute } from './learn.$lang'

export const learnLessonEditRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'lessons/$lessonId/edit',
  component: function EditLessonView() {
    const { lang, lessonId } = learnLessonEditRoute.useParams()
    const navigate = useNavigate()
    return (
      <EditLessonPage
        lessonId={lessonId}
        lang={lang}
        onClose={() => {
          void navigate({ to: '/learn/$lang/library', params: { lang } })
        }}
      />
    )
  },
})
