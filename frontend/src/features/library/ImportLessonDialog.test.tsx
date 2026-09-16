import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ lang: 'pt' }) }))

import { setUiLanguage } from '@/lib/i18n'
import { ImportLessonDialog } from './ImportLessonDialog'

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

function setup() {
  const close = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ImportLessonDialog open onOpenChange={close} />
    </QueryClientProvider>,
  )
  return close
}

it('uploads a dropped file with edited title and CSRF, then polls until ready', async () => {
  const requests: RequestInit[] = []
  let polls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        requests.push(init)
        return new Response(JSON.stringify({ id: 'L1', status: 'processing' }), { status: 202 })
      }
      polls++
      return new Response(
        JSON.stringify({ id: 'L1', status: polls === 1 ? 'processing' : 'ready' }),
      )
    }),
  )
  document.cookie = 'glosano_csrf=test-token'
  const close = setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'File' }))
  fireEvent.drop(screen.getByLabelText('Drop a file here'), {
    dataTransfer: { files: [new File(['Olá mundo'], 'chapter.md', { type: 'text/markdown' })] },
  })
  expect(screen.getByLabelText('Title')).toHaveValue('chapter')
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'My chapter')
  await user.click(screen.getByRole('button', { name: 'Create lesson' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Processing lesson')
  expect(close).not.toHaveBeenCalled()
  const body = requests[0]?.body as FormData
  expect(body.get('title')).toBe('My chapter')
  expect(body.get('language_code')).toBe('pt')
  expect(body.get('file')).toBeInstanceOf(File)
  expect(new Headers(requests[0]?.headers).get('Content-Type')).toBeNull()
  expect(new Headers(requests[0]?.headers).get('X-CSRF-Token')).toBe('test-token')
  await waitFor(() => expect(close).toHaveBeenCalledWith(false), { timeout: 4000 })
})

it('supports picker and displays worker failure without resubmitting', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify({ id: 'L1', status: init.method === 'POST' ? 'processing' : 'failed' }),
        ),
    ),
  )
  const close = setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'File' }))
  await user.upload(
    screen.getByLabelText('Choose file'),
    new File(['Hello'], 'book.txt', { type: 'text/plain' }),
  )
  await user.click(screen.getByRole('button', { name: 'Create lesson' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not process the lesson')
  expect(close).not.toHaveBeenCalled()
})

it('rejects unsupported and oversized drops before upload, with live localization', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  setup()
  await userEvent.click(screen.getByRole('tab', { name: 'File' }))
  const drop = screen.getByLabelText('Drop a file here')
  fireEvent.drop(drop, { dataTransfer: { files: [new File(['PDF'], 'book.pdf')] } })
  expect(screen.getByRole('alert')).toHaveTextContent('Only .txt and .md')
  act(() => setUiLanguage('ru'))
  expect(screen.getByRole('alert')).toHaveTextContent('Поддерживаются только .txt и .md')
  fireEvent.drop(drop, {
    dataTransfer: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.txt')] },
  })
  expect(screen.getByRole('alert')).toHaveTextContent('5 МиБ')
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps pasted text import JSON-compatible and waits for processing', async () => {
  let payload: RequestInit | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') payload = init
      return new Response(
        JSON.stringify({ id: 'L2', status: init.method === 'POST' ? 'processing' : 'ready' }),
      )
    }),
  )
  const close = setup()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Title'), 'Pasted text')
  await user.type(screen.getByRole('textbox', { name: 'Text' }), 'Olá mundo')
  await user.click(screen.getByRole('button', { name: 'Create lesson' }))
  await waitFor(() => expect(close).toHaveBeenCalledWith(false))
  expect(JSON.parse(payload?.body as string)).toEqual({
    title: 'Pasted text',
    raw_text: 'Olá mundo',
    language_code: 'pt',
    visibility: 'private',
  })
  expect(new Headers(payload?.headers).get('Content-Type')).toBe('application/json')
})

it('shows an actionable UTF-8 error and allows correcting the upload', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'lesson file must be UTF-8' }), { status: 422 }),
    ),
  )
  setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'File' }))
  await user.upload(
    screen.getByLabelText('Choose file'),
    new File(['bad encoding'], 'book.txt', { type: 'text/plain' }),
  )
  await user.click(screen.getByRole('button', { name: 'Create lesson' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Save the file as UTF-8')
  expect(screen.getByRole('button', { name: 'Create lesson' })).toBeEnabled()
  expect(screen.getByLabelText('Title')).toHaveValue('book')
})

it('imports a YouTube link without a title and retries the same failed material', async () => {
  const posts: { url: string; body: unknown }[] = []
  let retried = false
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      posts.push({ url, body: init.body ? JSON.parse(init.body as string) : null })
      if (url.endsWith('/retry-import')) retried = true
      return new Response(JSON.stringify({ id: 'Y1', status: 'processing' }), { status: 202 })
    }
    return new Response(
      JSON.stringify({
        id: 'Y1',
        status: retried ? 'ready' : 'failed',
        import_error: { code: 'network_error', retryable: true },
      }),
    )
  })
  const close = setup()
  await userEvent.click(screen.getByRole('tab', { name: 'YouTube' }))
  expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('YouTube link'), 'https://youtu.be/M7lc1UVf-VE')
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach YouTube')
  expect(posts[0]).toEqual({
    url: '/api/lessons/import-youtube',
    body: {
      url: 'https://youtu.be/M7lc1UVf-VE',
      language_code: 'pt',
      request_id: expect.any(String),
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Retry import' }))
  await waitFor(() => expect(close).toHaveBeenCalledWith(false))
  expect(posts.map((post) => post.url)).toEqual([
    '/api/lessons/import-youtube',
    '/api/lessons/Y1/retry-import',
  ])
})

it('reuses the import request id after an ambiguous network failure', async () => {
  const bodies: { request_id: string }[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string))
    throw new TypeError('Network unavailable')
  })
  setup()
  await userEvent.click(screen.getByRole('tab', { name: 'YouTube' }))
  await userEvent.type(screen.getByLabelText('YouTube link'), 'https://youtu.be/M7lc1UVf-VE')
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(bodies).toHaveLength(2))
  expect(bodies[0]?.request_id).toBe(bodies[1]?.request_id)
})
