import { createRoute, redirect } from '@tanstack/react-router'
import { AISettingsPage } from '@/features/admin/AISettingsPage'
import { rootRoute } from './__rootRoute'

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai' })
  },
})
export const adminAIRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/ai',
  component: AISettingsPage,
})
