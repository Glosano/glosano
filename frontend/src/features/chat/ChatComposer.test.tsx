import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { chatsApi } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { chatDrafts } from './chatStore'
import { ChatComposer } from './ChatComposer'
vi.mock('./ChatCitation', () => ({ ChatCitation: () => <blockquote>Selected quote</blockquote> }))
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
