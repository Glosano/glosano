import { createRoute } from '@tanstack/react-router'

import { AuthPage } from '@/features/auth/AuthPage'
import { RegisterForm } from '@/features/auth/RegisterForm'

import { rootRoute } from './__rootRoute'

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: () => (
    <AuthPage>
      <RegisterForm />
    </AuthPage>
  ),
})
