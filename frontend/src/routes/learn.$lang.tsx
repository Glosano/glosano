import { Outlet, createRoute, redirect } from '@tanstack/react-router'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppTopBar } from '@/components/AppTopBar'
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
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-background">
          <AppTopBar />
          <main>
            <Outlet />
          </main>
        </div>
      </ProtectedRoute>
    )
  },
})
