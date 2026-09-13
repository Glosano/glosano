import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setUiLanguage } from '@/lib/i18n'
import { EditLessonPage } from './EditLessonPage'

const material = {
  id: 'L1',
  title: 'Olá',
  raw_text: 'Olá mundo.',
  language_code: 'pt',
  status: 'ready',
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

function setup() {
  const leave = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <EditLessonPage lessonId="L1" lang="pt" onClose={leave} />
    </QueryClientProvider>,
  )
  return leave
}

it('loads a nonmodal editor, saves both fields with CSRF and invalidates reader content', async () => {
  const requests: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PATCH') requests.push(init)
    return new Response(JSON.stringify(material))
  })
  document.cookie = 'flinq_csrf=edit-token'
  client.setQueryData(['reader-content', 'L1'], { old: true })
  const leave = setup()
  expect(await screen.findByLabelText('Title')).toHaveValue('Olá')
  expect(screen.getByLabelText('Text')).toHaveValue('Olá mundo.')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } })
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Novo texto.' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(leave).toHaveBeenCalledOnce())
  expect(JSON.parse(requests[0]?.body as string)).toEqual({
    title: 'New title',
    raw_text: 'Novo texto.',
  })
  expect(new Headers(requests[0]?.headers).get('X-CSRF-Token')).toBe('edit-token')
  expect(client.getQueryState(['reader-content', 'L1'])?.isInvalidated).toBe(true)
})

it('cancels edits without sending a mutation', async () => {
  const requests: RequestInit[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(init)
    return new Response(JSON.stringify(material))
  })
  const leave = setup()
  fireEvent.change(await screen.findByLabelText('Text'), { target: { value: 'Unsaved' } })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(leave).toHaveBeenCalledOnce()
  expect(requests.every((r) => !r.method || r.method === 'GET')).toBe(true)
})

it('retains drafts after a failed save and on background refetch; retry succeeds', async () => {
  let failed = true
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PATCH' && failed) return new Response('', { status: 503 })
    return new Response(JSON.stringify(material))
  })
  const leave = setup()
  fireEvent.change(await screen.findByLabelText('Text'), { target: { value: 'Draft text.' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['lesson-edit', 'L1'] })
  })
  expect(screen.getByLabelText('Text')).toHaveValue('Draft text.')
  expect(leave).not.toHaveBeenCalled()
  failed = false
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(leave).toHaveBeenCalledOnce())
})

it('validates empty fields locally and localizes the error live', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(material)))
  setup()
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: ' ' } })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a title and text')
  act(() => setUiLanguage('ru'))
  expect(screen.getByRole('alert')).toHaveTextContent('Заполните название и текст')
})

it('shows unavailable material without exposing an empty edit form', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
  const leave = setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('Material not found')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(leave).toHaveBeenCalledOnce()
})
