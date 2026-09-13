import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { lessonsApi } from '@/api/lessons'
import { setUiLanguage } from '@/lib/i18n'
import { LessonCard } from './LessonCard'

const lesson = {
  id: 'L1',
  title: 'Olá mundo',
  language_code: 'pt',
  word_count: 2,
  visibility: 'private' as const,
  status: 'ready' as const,
  created_at: '',
  read_percent: 50,
  new_words_remaining: 1,
  can_manage: true,
}
let client: QueryClient
beforeEach(() => {
  setUiLanguage('en')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
  act(() => setUiLanguage('ru'))
})

function Library() {
  const { data } = useQuery({ queryKey: ['lessons', 'pt'], queryFn: () => lessonsApi.list('pt') })
  return (
    <>
      {data?.items.map((item) => (
        <LessonCard key={item.id} lesson={item} />
      ))}
    </>
  )
}

it('opens actions outside the reader link and exposes the separate edit URL', async () => {
  render(<LessonCard lesson={lesson} />)
  const trigger = screen.getByRole('button', { name: 'Material actions' })
  expect(trigger.closest('a')).toBeNull()
  await userEvent.click(trigger)
  expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
    'href',
    '/learn/pt/lessons/L1/edit',
  )
  act(() => setUiLanguage('ru'))
  expect(screen.getByRole('menuitem', { name: 'Редактировать' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument()
})

it('cancels without a request, then removes the card only after confirmed deletion', async () => {
  let deleted = false
  const requests: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'DELETE') {
      requests.push(init)
      deleted = true
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ items: deleted ? [] : [lesson], total: deleted ? 0 : 1 }))
  })
  document.cookie = 'flinq_csrf=delete-token'
  render(
    <QueryClientProvider client={client}>
      <Library />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Material actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Olá mundo')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(requests).toHaveLength(0)
  expect(screen.getByRole('heading', { name: lesson.title })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Material actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Yes' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: lesson.title })).not.toBeInTheDocument(),
  )
  expect(requests).toHaveLength(1)
  expect(new Headers(requests[0]?.headers).get('X-CSRF-Token')).toBe('delete-token')
})

it('keeps the card and dialog when deletion fails and allows retry', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }))
  render(
    <QueryClientProvider client={client}>
      <LessonCard lesson={lesson} />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Material actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Yes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('try again')
  expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('heading', { name: lesson.title })).toBeInTheDocument()
})

it('does not offer mutation actions for another user’s shared material', async () => {
  render(<LessonCard lesson={{ ...lesson, visibility: 'shared', can_manage: false }} />)
  fireEvent.keyDown(screen.getByRole('link'), { key: 'Enter' })
  expect(screen.queryByRole('button', { name: 'Material actions' })).not.toBeInTheDocument()
})
