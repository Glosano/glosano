import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('@/test/routerLinkMock')).MockLink,
}))

import type { LessonSummary } from '@/api/lessons'
import { setUiLanguage } from '@/lib/i18n'
import { LessonCard } from './LessonCard'

const lesson: LessonSummary = {
  id: 'L1',
  title: 'Olá mundo',
  language_code: 'pt',
  word_count: 2,
  visibility: 'private',
  status: 'ready',
  created_at: '',
  read_percent: 0,
  new_words_remaining: 1,
  can_manage: true,
  tags: ['news', 'b2'],
}
let client: QueryClient
beforeEach(() => {
  setUiLanguage('en')
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
  act(() => setUiLanguage('ru'))
})

function renderCard(item: LessonSummary = lesson) {
  render(
    <QueryClientProvider client={client}>
      <LessonCard lesson={item} />
    </QueryClientProvider>,
  )
}

async function openTags(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Material actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Tags…' }))
}

it('edits personal tags from the card menu with CSRF', async () => {
  const requests: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ tags: ['b2', 'podcast'] }))
  })
  document.cookie = 'glosano_csrf=tags-token'
  renderCard()
  const user = userEvent.setup()
  await openTags(user)
  const input = screen.getByLabelText('Tags (comma-separated)')
  expect(input).toHaveValue('news, b2')
  await user.clear(input)
  await user.type(input, 'Podcast, b2')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(requests[0]?.url).toBe('/api/lessons/L1/tags')
  expect(requests[0]?.init.method).toBe('PUT')
  expect(JSON.parse(requests[0]?.init.body as string)).toEqual({ tags: ['podcast', 'b2'] })
  expect(new Headers(requests[0]?.init.headers).get('X-CSRF-Token')).toBe('tags-token')
})

it('explains a material that is no longer available', async () => {
  vi.stubGlobal('fetch', async () => new Response('{"detail":"Not Found"}', { status: 404 }))
  renderCard()
  const user = userEvent.setup()
  await openTags(user)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The material is unavailable.')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('blocks an overlong tag without a request', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  renderCard()
  const user = userEvent.setup()
  await openTags(user)
  fireEvent.change(screen.getByLabelText('Tags (comma-separated)'), {
    target: { value: 'x'.repeat(41) },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('alert')).toHaveTextContent('A tag must be at most 40 characters.')
  expect(fetch).not.toHaveBeenCalled()
})
