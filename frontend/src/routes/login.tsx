import { createRoute } from '@tanstack/react-router'

import { AuthPage } from '@/features/auth/AuthPage'
import { LoginForm } from '@/features/auth/LoginForm'

import { rootRoute } from './__rootRoute'

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => (
    <AuthPage>
      <LoginForm />
    </AuthPage>
  ),
})
