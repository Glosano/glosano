import { createRoute, redirect } from '@tanstack/react-router'
import { rootRoute } from './__rootRoute'

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    throw redirect({ to: '/settings/ai' })
  },
})
export const adminAIRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/ai',
  beforeLoad: () => {
    throw redirect({ to: '/settings/ai' })
  },
})
