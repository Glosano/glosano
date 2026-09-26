import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chatsApi } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { COMPACT_QUERY } from '@/lib/useMediaQuery'
import { clearMediaQueries, mockMediaQueries } from '@/test/mockMediaQueries'
import { chatDrafts } from './chatStore'
import { ChatWorkspace } from './ChatWorkspace'
import { useChatLayoutStore } from './chatLayoutStore'
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
afterEach(() => clearMediaQueries())
beforeEach(() => {
  vi.restoreAllMocks()
  setUiLanguage('en')
  useChatLayoutStore.setState({ sidebarOpen: false })
  chatDrafts.setUser(null)
  chatDrafts.setUser('user')
  vi.spyOn(chatsApi, 'list').mockResolvedValue({
    items: [
      {
        id: 'a',
        title: 'Earlier conversation',
        learning_language_code: 'pt',
        created_at: '2026-09-18T12:00:00Z',
        updated_at: '2026-09-18T12:00:00Z',
      },
    ],
  })
  vi.spyOn(chatsApi, 'capabilities').mockResolvedValue({
    ai_enabled: true,
    max_attachments: 4,
    context_char_budget: 24000,
    attachment_char_limit: 6000,
    answer_max_tokens: 1500,
    draft_text_char_limit: 16000,
  })
  vi.spyOn(chatsApi, 'draft').mockImplementation(async (id) => ({
    revision: 0,
    text: id ? 'Saved draft' : '',
    citation_ids: [],
    exercise_id: null,
    attempt_id: null,
    answers: {},
  }))
  vi.spyOn(chatsApi, 'detail').mockResolvedValue({
    id: 'a',
    title: 'Earlier conversation',
    learning_language_code: 'pt',
    created_at: '',
    updated_at: '',
    ai_enabled: true,
    attempts: [],
    generations: [],
    messages: [
      {
        id: 'm',
        role: 'assistant',
        text: 'Saved answer',
        state: 'complete',
        created_at: '2026-09-18T12:00:00Z',
        ui_language: 'en',
        exercise_id: null,
        attempt_id: null,
        citations: [],
        exercises: [],
      },
    ],
  })
})
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChatWorkspace lang="pt" />
    </QueryClientProvider>,
  )
}
it('opens an existing conversation with history and its sole durable composer, then preserves it on new conversation', async () => {
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  await screen.findByText('Saved answer')
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft')
  expect(screen.getAllByRole('textbox', { name: 'Message' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''))
  expect(chatDrafts.get('a').draft.text).toBe('Saved draft')
  expect(screen.queryByText('Saved answer')).not.toBeInTheDocument()
})

it('keeps the active draft when collapsing the sidebar and remembers the layout after remount', async () => {
  const view = show()
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
  expect(screen.queryByRole('button', { name: 'Earlier conversation' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft')
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  view.unmount()
  show()
  expect(screen.getByRole('button', { name: 'Close sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(await screen.findByRole('button', { name: 'Earlier conversation' })).toHaveAttribute(
    'aria-current',
    'true',
  )
})

it('renames a conversation through its menu without changing the active draft', async () => {
  const user = userEvent.setup({ skipHover: true })
  const rename = vi.spyOn(chatsApi, 'rename').mockResolvedValue({
    id: 'a',
    title: 'Updated title',
    learning_language_code: 'pt',
    created_at: '2026-09-18T12:00:00Z',
    updated_at: '2026-09-21T12:00:00Z',
  })
  show()
  await user.click(screen.getByRole('button', { name: 'Open sidebar' }))
  await user.click(
    await screen.findByRole('button', { name: 'Conversation actions: Earlier conversation' }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
  const title = screen.getByRole('textbox', { name: 'Conversation title' })
  await user.clear(title)
  await user.type(title, 'Updated title')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(rename).toHaveBeenCalledWith('a', 'Updated title')
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
})

it('requires confirmation before deleting the active conversation from its menu', async () => {
  const user = userEvent.setup({ skipHover: true })
  const remove = vi.spyOn(chatsApi, 'delete').mockResolvedValue(undefined)
  chatDrafts.select('a')
  show()
  await screen.findByText('Saved answer')
  await user.click(screen.getByRole('button', { name: 'Open sidebar' }))
  await user.click(
    screen.getByRole('button', { name: 'Conversation actions: Earlier conversation' }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(remove).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft')
  await user.click(
    screen.getByRole('button', { name: 'Conversation actions: Earlier conversation' }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  vi.mocked(chatsApi.list).mockResolvedValue({ items: [] })
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(remove).toHaveBeenCalledWith('a')
  expect(screen.queryByText('Saved answer')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
})
it('retains unsent content and exposes explicit conflict choices', async () => {
  show()
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  fireEvent.change(input, { target: { value: 'Local copy' } })
  vi.spyOn(chatsApi, 'saveDraft').mockRejectedValue(new Error('Offline'))
  await act(async () => {
    await chatDrafts.flush(null).catch(() => {})
  })
  expect(input).toHaveValue('Local copy')
  expect(await screen.findByText('Not saved to server')).toBeInTheDocument()
})
it('renders safe Markdown without raw HTML, unsafe links or remote images', async () => {
  chatDrafts.select('a')
  const detail = await chatsApi.detail('a')
  vi.mocked(chatsApi.detail).mockResolvedValue({
    ...detail,
    messages: [
      {
        ...detail.messages[0]!,
        text: '**Important** [unsafe](javascript:alert(1)) ![tracking](https://evil.test/pixel.png) <script>attack()</script>',
      },
    ],
  })
  show()
  await screen.findByText('Important')
  expect(screen.getByText('Important').tagName).toBe('STRONG')
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('unsafe')).not.toHaveAttribute('href', 'javascript:alert(1)')
})
it('renders tables and strikethrough in chat replies', async () => {
  chatDrafts.select('a')
  const detail = await chatsApi.detail('a')
  vi.mocked(chatsApi.detail).mockResolvedValue({
    ...detail,
    messages: [
      {
        ...detail.messages[0]!,
        text: '## Vocabulary\n\n| Word | Meaning |\n| --- | --- |\n| way | путь |\n\n~~old meaning~~',
      },
    ],
  })
  show()
  expect(await screen.findByRole('heading', { name: 'Vocabulary' })).toBeInTheDocument()
  expect(screen.getByRole('table')).toHaveTextContent('way')
  expect(screen.getByRole('cell', { name: 'путь' })).toBeInTheDocument()
  expect(screen.getByText('old meaning').tagName).toBe('DEL')
})

it('loads older transcript pages rather than treating the latest window as complete history', async () => {
  chatDrafts.select('a')
  const detail = await chatsApi.detail('a')
  const recent = Array.from({ length: 50 }, (_, i) => ({
    ...detail.messages[0]!,
    id: `m${i}`,
    text: `Recent ${i}`,
    created_at: `2026-09-18T12:${String(i).padStart(2, '0')}:00Z`,
  }))
  vi.mocked(chatsApi.detail).mockImplementation(async (_, before) => ({
    ...detail,
    messages: before
      ? [
          {
            ...detail.messages[0]!,
            id: 'old',
            text: 'Older saved answer',
            created_at: '2026-09-17T00:00:00Z',
          },
        ]
      : recent,
  }))
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier messages' }))
  await screen.findByText('Older saved answer')
  expect(screen.getByText('Recent 49')).toBeInTheDocument()
})
it('offers both versions of a conflicted draft without automatically overwriting the server', async () => {
  const { ApiError } = await import('@/api/client')
  vi.spyOn(chatsApi, 'saveDraft').mockRejectedValue(
    new ApiError(409, 'draft_conflict', {
      code: 'draft_conflict',
      draft: {
        revision: 9,
        text: 'Other device',
        citation_ids: [],
        exercise_id: null,
        attempt_id: null,
        answers: {},
      },
    }),
  )
  show()
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  fireEvent.change(input, { target: { value: 'My copy' } })
  await act(async () => {
    await chatDrafts.flush(null).catch(() => {})
  })
  expect(input).toHaveValue('My copy')
  expect(screen.getByText('Other device')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Load server version' }))
  expect(input).toHaveValue('Other device')
})

it('keeps historical text visible while excluding old practice cards and actions', async () => {
  chatDrafts.select('a')
  const detail = await chatsApi.detail('a')
  vi.mocked(chatsApi.detail).mockResolvedValue({
    ...detail,
    messages: [
      {
        ...detail.messages[0]!,
        exercises: [
          {
            id: 'legacy',
            kind: 'gap',
            prompt: 'Private practice prompt',
            conversation_id: 'a',
            public_data: {},
          } as never,
        ],
      },
    ],
  })
  show()
  await screen.findByText('Saved answer')
  expect(screen.queryByText('Private practice prompt')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Submit answer|Similar practice|Discuss attempt/ }),
  ).not.toBeInTheDocument()
})

it('shows a one-line hint instead of a large empty-state heading', async () => {
  show()
  expect(
    await screen.findByText(
      'Click the plus to the left of a paragraph to quote it, then ask a question.',
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Discussion starts/ })).not.toBeInTheDocument()
})

it('moves the conversation controls into the chat header on phones', async () => {
  mockMediaQueries([COMPACT_QUERY])
  show()
  const header = screen.getByRole('heading', { name: 'New conversation' }).closest('header')!
  const toggles = screen.getAllByRole('button', { name: 'Open sidebar' })
  expect(toggles).toHaveLength(1)
  expect(header).toContainElement(toggles[0]!)
  expect(header).toContainElement(screen.getByRole('button', { name: 'New conversation' }))
  fireEvent.click(toggles[0]!)
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  await screen.findByText('Saved answer')
})

it('stops a running reply from the composer button', async () => {
  vi.mocked(chatsApi.detail).mockResolvedValue({
    ...(await chatsApi.detail('a')),
    generations: [
      {
        id: 'g',
        conversation_id: 'a',
        operation_id: 'op',
        kind: 'reply',
        message_id: 'm',
        attempt_id: null,
        status: 'running',
        partial_text: 'Partial',
        heartbeat_at: null,
        error_code: null,
        context_truncated: false,
        exercise_kind: null,
        ui_language: 'en',
      },
    ],
  })
  const cancel = vi.spyOn(chatsApi, 'cancel').mockResolvedValue(undefined as never)
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Generating…')
  fireEvent.click(await screen.findByRole('button', { name: 'Stop response' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('a', 'g'))
})

it('shows replies without a header, marks them AI-generated and copies their text', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  const reply = (await screen.findByText('Saved answer')).closest('[data-message-role]')!
  expect(reply).not.toHaveTextContent('AI-generated')
  expect(screen.getByText('AI-generated')).toBeInTheDocument()
  expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-09-18T12:00:00Z')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Saved answer'))
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  Reflect.deleteProperty(navigator, 'clipboard')
})

it('shows no action row for a reply stopped before any text', async () => {
  vi.mocked(chatsApi.detail).mockResolvedValue({
    ...(await chatsApi.detail('a')),
    messages: [
      {
        id: 'm',
        role: 'assistant',
        text: '',
        state: 'cancelled',
        created_at: '2026-09-18T12:00:00Z',
        ui_language: 'en',
        exercise_id: null,
        attempt_id: null,
        citations: [],
        exercises: [],
      },
    ],
  })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Earlier conversation' }))
  await screen.findByLabelText('Response cancelled')
  expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  expect(screen.queryByText('AI-generated')).not.toBeInTheDocument()
})
