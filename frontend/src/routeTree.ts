import { createRoute } from '@tanstack/react-router'

import { IndexRoute } from './routes/index'
import { rootRoute } from './routes/__rootRoute'
import { loginRoute } from './routes/login'
import { registerRoute } from './routes/register'
import { onboardingRoute } from './routes/onboarding'
import { learnLangRoute } from './routes/learn.$lang'
import { learnLibraryRoute } from './routes/learn.$lang.library'
import { learnLessonRoute } from './routes/learn.$lang.lessons.$lessonId'
import { learnVocabularyRoute } from './routes/learn.$lang.vocabulary'
import { learnReviewRoute } from './routes/learn.$lang.review'
import {
  settingsRoute,
  settingsIndexRoute,
  settingsProfileRoute,
  settingsPreferencesRoute,
  settingsDataRoute,
} from './routes/settings'

export { rootRoute } from './routes/__rootRoute'
export type { RouterContext } from './routes/__rootRoute'

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRoute,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  onboardingRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    settingsProfileRoute,
    settingsPreferencesRoute,
    settingsDataRoute,
  ]),
  learnLangRoute.addChildren([
    learnLibraryRoute,
    learnLessonRoute,
    learnVocabularyRoute,
    learnReviewRoute,
  ]),
])
