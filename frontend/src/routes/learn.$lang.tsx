import { Outlet, createRoute, redirect, useRouterState } from '@tanstack/react-router'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppTopBar } from '@/components/AppTopBar'
import { isReaderPath } from '@/features/reader/readerPath'
import { isLearningLanguageCode } from '@/lib/languages'

import { rootRoute } from './__rootRoute'

export const learnLangRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/learn/$lang',
  beforeLoad: ({ params }) => {
    if (!isLearningLanguageCode(params.lang)) {
      throw redirect({ to: '/' })
    }
  },
  component: function LearnLangLayout() {
    const reader = useRouterState({ select: (state) => isReaderPath(state.location.pathname) })
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-background">
          {/* Phones read with the lesson bar only; its close button leads back to the library. */}
          <div className={reader ? 'hidden md:block' : undefined}>
            <AppTopBar />
          </div>
          <main>
            <Outlet />
          </main>
        </div>
      </ProtectedRoute>
    )
  },
})
