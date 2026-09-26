import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chatsApi } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { COARSE_POINTER_QUERY } from '@/lib/useMediaQuery'
import { clearMediaQueries, mockMediaQueries } from '@/test/mockMediaQueries'
import { chatDrafts } from './chatStore'
import { ChatComposer } from './ChatComposer'
vi.mock('./ChatCitation', () => ({ ChatCitation: () => <blockquote>Selected quote</blockquote> }))
afterEach(() => clearMediaQueries())
beforeEach(() => {
  vi.restoreAllMocks()
  setUiLanguage('en')
  chatDrafts.setUser(null)
  chatDrafts.setUser('composer-user')
  vi.spyOn(chatsApi, 'draft').mockResolvedValue({
    revision: 0,
    text: '',
    citation_ids: [],
    exercise_id: null,
    attempt_id: null,
    answers: {},
  })
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
})
it('reconciles a lost acknowledgement after clearing the composer with the same operation ID', async () => {
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockRejectedValueOnce(new Error('Lost acknowledgement'))
    .mockResolvedValue({ conversation_id: 'accepted', generation: { id: 'gen' } as never })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatComposer id={null} lang="en" aiEnabled busy={false} />
    </QueryClientProvider>,
  )
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  fireEvent.change(input, { target: { value: 'Original question' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByRole('button', { name: 'Retry sending' })
  await waitFor(() => expect(chatDrafts.get(null).sending).toBe(false))
  fireEvent.change(input, { target: { value: '' } })
  const retry = screen.getByRole('button', { name: 'Retry sending' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  await waitFor(() => expect(chatDrafts.active()).toBe('accepted'))
  expect(send.mock.calls[1]![0].operation_id).toBe(send.mock.calls[0]![0].operation_id)
  expect(chatDrafts.get('accepted').draft.text).toBe('')
  expect(chatDrafts.get('accepted').pending).toBeNull()
  await act(async () => {})
})

it('requires a question even with a citation and exposes no practice format', async () => {
  await chatDrafts.load(null)
  chatDrafts.edit(null, { text: '```\nSelected quote\n```\n\n' })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatComposer id={null} lang="en" aiEnabled busy={false} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
})

it('lets the user explicitly remove legacy contexts that exceed the limit without losing the question', async () => {
  const ids = ['a', 'b', 'c', 'd']
  vi.mocked(chatsApi.draft).mockResolvedValue({
    revision: 2,
    text: '',
    citation_ids: ids,
    exercise_id: null,
    attempt_id: null,
    answers: {},
  })
  vi.spyOn(chatsApi, 'citation').mockImplementation(
    async (id) =>
      ({ id, context_text: id.repeat(3998) }) as Awaited<ReturnType<typeof chatsApi.citation>>,
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatComposer id={null} lang="en" aiEnabled busy={false} />
    </QueryClientProvider>,
  )
  await screen.findByRole('alert')
  const input = screen.getByRole('textbox', { name: 'Message' })
  expect(chatDrafts.get(null).draft.citation_ids).toEqual(ids)
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  const remove = screen.getByRole('button', { name: 'Remove old quotes' })
  fireEvent.change(input, { target: { value: 'Keep this question' } })
  fireEvent.click(remove)
  expect(input).toHaveValue('Keep this question')
  expect(chatDrafts.get(null).draft.citation_ids).toEqual([])
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  await act(async () => {
    await chatDrafts.flush(null)
  })
  expect(chatsApi.saveDraft).toHaveBeenCalledWith(
    null,
    expect.objectContaining({ text: 'Keep this question', citation_ids: [], revision: 2 }),
  )
})

it('keeps migration recovery editable through consecutive edits and retries successfully', async () => {
  vi.mocked(chatsApi.draft).mockResolvedValue({
    revision: 2,
    text: 'Question',
    citation_ids: ['c'],
    exercise_id: null,
    attempt_id: null,
    answers: {},
  })
  vi.spyOn(chatsApi, 'citation')
    .mockRejectedValueOnce(new Error('Snapshot unavailable'))
    .mockResolvedValue({ id: 'c', context_text: 'Full paragraph' } as Awaited<
      ReturnType<typeof chatsApi.citation>
    >)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatComposer id={null} lang="en" aiEnabled busy={false} />
    </QueryClientProvider>,
  )
  await screen.findByRole('alert')
  const input = screen.getByRole('textbox', { name: 'Message' })
  for (const text of ['Question a', 'Question ab', 'Question abc']) {
    fireEvent.change(input, { target: { value: text } })
    expect(input).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Retry adding quotes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  }
  await act(async () => {
    await chatDrafts.flush(null)
  })
  expect(chatsApi.saveDraft).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry adding quotes' }))
  await waitFor(() => expect(input).toHaveValue('Question abc\n\n```\nFull paragraph\n```\n\n'))
  expect(input).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Retry adding quotes' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
})

function renderComposer(props: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatComposer id={null} lang="en" aiEnabled busy={false} {...props} />
    </QueryClientProvider>,
  )
}

it('starts as a single line with the send button inside the field', async () => {
  renderComposer()
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  expect(input).toHaveAttribute('rows', '1')
  expect(input.closest('[data-chat-input]')).toContainElement(
    screen.getByRole('button', { name: 'Send' }),
  )
})

it('hides routine draft status and shows the context limit only near it', async () => {
  renderComposer({
    capabilities: {
      ai_enabled: true,
      max_attachments: 4,
      context_char_budget: 100,
      attachment_char_limit: 60,
      answer_max_tokens: 100,
      draft_text_char_limit: 1000,
    },
  })
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  expect(screen.queryByText('Draft saved')).not.toBeInTheDocument()
  expect(screen.queryByText(/Context limit/)).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'short question' } })
  expect(screen.queryByText('Draft on this device')).not.toBeInTheDocument()
  expect(screen.queryByText(/Context limit/)).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: 'x'.repeat(81) } })
  expect(screen.getByText('Context limit: 100 characters.')).toBeInTheDocument()
})

it('turns the send button into stop while a reply is generating', async () => {
  const onStop = vi.fn()
  renderComposer({ busy: true, onStop })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled())
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Stop response' }))
  expect(onStop).toHaveBeenCalledOnce()
})

it('keeps Enter for new lines on touch screens and sends on desktop', async () => {
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockResolvedValue({ conversation_id: 'accepted', generation: { id: 'gen' } as never })
  mockMediaQueries([COARSE_POINTER_QUERY])
  const touch = renderComposer()
  const input = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).not.toBeDisabled())
  fireEvent.change(input, { target: { value: 'Question' } })
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
  expect(send).not.toHaveBeenCalled()
  touch.unmount()

  clearMediaQueries()
  renderComposer()
  const desktopInput = screen.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(desktopInput).not.toBeDisabled())
  fireEvent.keyDown(desktopInput, { key: 'Enter' })
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  await act(async () => {})
})
