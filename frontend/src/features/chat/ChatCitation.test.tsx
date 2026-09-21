import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { chatsApi, type Citation } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { chatDrafts } from './chatStore'
import { ChatCitation } from './ChatCitation'
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
const snapshot: Citation = {
  id: 'cite',
  lesson_id: 'lesson',
  source_version: 1,
  title: 'Lesson',
  language_code: 'en',
  selected_text: 'Hello',
  context_text: 'Hello world.',
  from_ordinal: 4,
  to_ordinal: 4,
  start_offset: 0,
  end_offset: 5,
  media_start_ms: null,
  media_end_ms: null,
  source_available: true,
  current_source_version: 1,
  source_current: true,
}
beforeEach(() => {
  vi.restoreAllMocks()
  navigate.mockReset()
  setUiLanguage('en')
  chatDrafts.setUser(null)
  chatDrafts.setUser('user')
})
function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChatCitation id="cite" snapshot={snapshot} />
    </QueryClientProvider>,
  )
}
it('rechecks current source before navigating and removes stale ordinals', async () => {
  vi.spyOn(chatsApi, 'citation').mockResolvedValue({
    ...snapshot,
    source_current: false,
    current_source_version: 2,
  })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open source' }))
  await waitFor(() => expect(navigate).toHaveBeenCalled())
  expect(navigate).toHaveBeenCalledWith({
    to: '/learn/$lang/lessons/$lessonId',
    params: { lang: 'en', lessonId: 'lesson' },
    search: {},
  })
  fireEvent.click(screen.getByText('Saved context snapshot'))
  expect(screen.getByText('Hello world.')).toBeInTheDocument()
})
it('never navigates to an unavailable source and keeps the snapshot', async () => {
  vi.spyOn(chatsApi, 'citation').mockResolvedValue({
    ...snapshot,
    lesson_id: null,
    source_available: false,
    source_current: false,
  })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open source' }))
  await screen.findByText('The source is unavailable. The snapshot is preserved.')
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.getByText('Hello')).toBeInTheDocument()
})
it('shows the exact repeated occurrence, with Unicode offsets, and no expansion control', async () => {
  const citation = {
    ...snapshot,
    context_text: '😀 Hello. Hello again.',
    selected_text: 'Hello',
    context_start_offset: 9,
    context_end_offset: 14,
  }
  vi.spyOn(chatsApi, 'citation').mockResolvedValue(citation)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatCitation id="cite" snapshot={citation} draftId={null} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('button', { name: 'Expand to paragraph' })).not.toBeInTheDocument()
  const marked = document.querySelector('mark')!
  expect(marked.textContent).toBe('Hello')
  expect(marked.previousSibling?.textContent).toBe('😀 Hello. ')
  expect(marked.nextSibling?.textContent).toBe(' again.')
})

it('passes the verified paragraph identity for navigation when the quote starts with punctuation', async () => {
  vi.spyOn(chatsApi, 'citation').mockResolvedValue({ ...snapshot, paragraph_index: 3 })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open source' }))
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ paragraphIndex: 3, sourceVersion: 1 }),
      }),
    ),
  )
})
