import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/me'
import { useLibraryStore } from '@/features/library/libraryStore'
import { useUserStore } from '@/stores/userStore'
import { AvatarMenu } from './AvatarMenu'

const router = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
}))
vi.mock('@/api/auth', () => ({
  authApi: { logout: vi.fn().mockResolvedValue({ ok: true }) },
}))

import { authApi } from '@/api/auth'

const baseUser = {
  id: 'user-1',
  email: 'learner@example.com',
  role: 'learner',
  display_name: 'Learner',
  ui_language_code: 'ru',
  learning_languages: ['pt'],
  last_learning_language_code: 'pt',
  needs_onboarding: false,
  onboarded_at: '2026-09-11T00:00:00Z',
  preferred_translation_language_code: 'ru',
  daily_goal_minutes: 15,
  daily_goal_reviews: 20,
} satisfies MeResponse

function show() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useUserStore.getState().setUser(baseUser)
  render(
    <QueryClientProvider client={queryClient}>
      <AvatarMenu />
    </QueryClientProvider>,
  )
  return { queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  useUserStore.getState().reset()
  useLibraryStore.getState().reset()
})

describe('AvatarMenu logout', () => {
  it('clears the library filters along with the user store', async () => {
    const user = userEvent.setup()
    useLibraryStore.getState().toggleTag('pt', 'news')
    useLibraryStore.getState().setSearch('grammar')
    show()

    await user.click(screen.getByRole('button', { name: 'Меню аккаунта' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Выйти' }))

    expect(authApi.logout).toHaveBeenCalled()
    expect(useLibraryStore.getState()).toMatchObject({ tags: [], tagsLang: null, search: '' })
    expect(useUserStore.getState().user).toBeNull()
    expect(router.navigate).toHaveBeenCalledWith({ to: '/login', replace: true })
  })
})
