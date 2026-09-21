import { waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { chatsApi, type ChatDraft, type Citation } from '@/api/chats'
import { chatDrafts, useChatStore } from './chatStore'
const empty = (revision = 0): ChatDraft => ({
  revision,
  text: '',
  citation_ids: [],
  exercise_id: null,
  attempt_id: null,
  answers: {},
})
const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  chatDrafts.setUser(null)
  chatDrafts.setUser('u1')
  vi.spyOn(chatsApi, 'citation').mockImplementation(
    async (id) => ({ id, context_text: 'Quote: ' + id }) as Citation,
  )
})
it('restores confirmed draft and attachments after switching conversations', async () => {
  vi.spyOn(chatsApi, 'draft').mockImplementation(async (id) => ({
    ...empty(2),
    text: id ?? 'new',
    citation_ids: ['citation'],
  }))
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'local A' })
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  await chatDrafts.flush('a')
  await chatDrafts.load('b')
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft).toMatchObject({
    text: 'local A',
    citation_ids: [],
    revision: 3,
  })
})
it('keeps text typed during send and retries a lost acknowledgement with the same operation', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  await chatDrafts.load(null)
  chatDrafts.edit(null, { text: 'Original' })
  const response = deferred<Awaited<ReturnType<typeof chatsApi.send>>>()
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockImplementationOnce(() => response.promise)
  await chatDrafts.send(null, 'pt').catch(() => {})
  const operation = send.mock.calls[0]![0].operation_id
  const retry = chatDrafts.send(null, 'pt')
  await Promise.resolve()
  chatDrafts.edit(null, { text: 'Next question' })
  vi.mocked(chatsApi.draft).mockResolvedValue(empty(2))
  response.resolve({ conversation_id: 'created', generation: { id: 'generation' } as never })
  await retry
  expect(send.mock.calls[1]![0].operation_id).toBe(operation)
  expect(chatDrafts.get('created').draft.text).toBe('Next question')
  expect(chatDrafts.active()).toBe('created')
})
it('keeps local edits on conflict and requires an explicit resolution', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Mine' })
  const remote = { ...empty(3), text: 'Theirs' }
  const save = vi
    .spyOn(chatsApi, 'saveDraft')
    .mockRejectedValue(
      new ApiError(409, 'draft_conflict', { code: 'draft_conflict', draft: remote }),
    )
  await chatDrafts.flush('a').catch(() => {})
  expect(chatDrafts.get('a').draft.text).toBe('Mine')
  expect(chatDrafts.get('a').conflict).toEqual(remote)
  await chatDrafts.flush('a').catch(() => {})
  expect(save).toHaveBeenCalledTimes(1)
  chatDrafts.resolve('a', 'server')
  expect(chatDrafts.get('a').draft.text).toBe('Theirs')
})
it('does not dispatch an old-user queued save after identity changes', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load(null)
  const first = deferred<ChatDraft>()
  const save = vi.spyOn(chatsApi, 'saveDraft').mockReturnValue(first.promise)
  chatDrafts.edit(null, { text: 'Private old user' })
  const writing = chatDrafts.flush(null)
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  chatDrafts.edit(null, { text: 'Old queued' })
  const queued = chatDrafts.flush(null)
  chatDrafts.setUser('u2')
  first.resolve({ ...empty(1), text: 'Private old user' })
  await Promise.allSettled([writing, queued])
  expect(save).toHaveBeenCalledTimes(1)
  expect(chatDrafts.get(null).draft.text).toBe('')
  expect(sessionStorage.getItem('glosano.chat.u1')).toBeNull()
})
it('restores unsaved local recovery after refresh without overwriting newer server data', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Unsent recovery' })
  chatDrafts.restoreSession()
  vi.mocked(chatsApi.draft).mockResolvedValue({ ...empty(5), text: 'Other device' })
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft.text).toBe('Unsent recovery')
  expect(chatDrafts.get('a').conflict?.text).toBe('Other device')
})
it('serializes answer edits with composer changes and never loses either field', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  const first = deferred<ChatDraft>()
  const save = vi
    .spyOn(chatsApi, 'saveDraft')
    .mockReturnValueOnce(first.promise)
    .mockImplementation(async (_, d) => ({ ...d, revision: d.revision + 1 }))
  chatDrafts.edit('a', { text: 'Question' })
  const writing = chatDrafts.flush('a')
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  chatDrafts.edit('a', { answers: { exercise: 'Unfinished answer' } })
  const queued = chatDrafts.flush('a')
  first.resolve({ ...empty(1), text: 'Question' })
  await Promise.all([writing, queued])
  expect(chatDrafts.get('a').draft).toMatchObject({
    revision: 2,
    text: 'Question',
    answers: { exercise: 'Unfinished answer' },
  })
})
it('deduplicates rapid sends while draft saving is still in flight', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Send once' })
  const saving = deferred<ChatDraft>()
  vi.spyOn(chatsApi, 'saveDraft').mockReturnValue(saving.promise)
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockResolvedValue({ conversation_id: 'a', generation: { id: 'gen' } as never })
  const one = chatDrafts.send('a', 'en'),
    two = chatDrafts.send('a', 'en')
  saving.resolve({ ...empty(1), text: 'Send once' })
  await Promise.all([one, two])
  expect(send).toHaveBeenCalledTimes(1)
})
it('does not adopt the created conversation after an explicit navigation to a new conversation', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  await chatDrafts.load(null)
  chatDrafts.edit(null, { text: 'Old conversation' })
  const response = deferred<Awaited<ReturnType<typeof chatsApi.send>>>()
  const send = vi.spyOn(chatsApi, 'send').mockReturnValue(response.promise)
  const sending = chatDrafts.send(null, 'pt')
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  chatDrafts.select(null)
  chatDrafts.edit(null, { text: 'A fresh conversation' })
  response.resolve({ conversation_id: 'created', generation: { id: 'gen' } as never })
  await sending
  expect(chatDrafts.active()).toBeNull()
  expect(chatDrafts.get(null).draft.text).toBe('A fresh conversation')
})
it('restores a lost send acknowledgement across refresh and opens only the accepted conversation', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  chatDrafts.select(null)
  await chatDrafts.load(null)
  chatDrafts.edit(null, { text: 'Question' })
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ conversation_id: 'accepted', generation: { id: 'gen' } as never })
  await chatDrafts.send(null, 'pt').catch(() => {})
  chatDrafts.restoreSession()
  await chatDrafts.send(null, 'pt')
  expect(send.mock.calls[0]![0].operation_id).toBe(send.mock.calls[1]![0].operation_id)
  expect(chatDrafts.active()).toBe('accepted')
  expect(chatDrafts.get('accepted').draft.text).toBe('')
})
it('captures the send body before a slow save so typing after clicking Send survives', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'First question' })
  const saved = deferred<ChatDraft>()
  const save = vi
    .spyOn(chatsApi, 'saveDraft')
    .mockReturnValueOnce(saved.promise)
    .mockImplementation(async (_, d) => ({ ...d, revision: d.revision + 1 }))
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockResolvedValue({ conversation_id: 'a', generation: { id: 'gen' } as never })
  const sending = chatDrafts.send('a', 'en')
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  chatDrafts.edit('a', { text: 'Next question while saving' })
  vi.mocked(chatsApi.draft).mockResolvedValue(empty(2))
  saved.resolve({ ...empty(1), text: 'First question' })
  await sending
  expect(send.mock.calls[0]![0].draft_revision).toBe(1)
  expect(chatDrafts.get('a').draft.text).toBe('Next question while saving')
})
it('does not erase a newer server draft written after send was accepted', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Sent' })
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  vi.spyOn(chatsApi, 'send').mockImplementation(async () => {
    vi.mocked(chatsApi.draft).mockResolvedValue({
      ...empty(3),
      text: 'New on another device',
      citation_ids: ['remote-citation'],
    })
    return { conversation_id: 'a', generation: { id: 'gen' } as never }
  })
  await chatDrafts.send('a', 'en')
  expect(chatDrafts.get('a').draft).toMatchObject({
    revision: 3,
    text: 'New on another device\n\n```\nQuote: remote-citation\n```\n\n',
    citation_ids: [],
  })
})

it('limits unfinished answers without blocking composer writes and removes cleared keys', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  for (let i = 0; i < 30; i++)
    expect(chatDrafts.editAnswer('a', `exercise-${i}`, `Answer ${i}`)).toBe(true)
  expect(chatDrafts.editAnswer('a', 'exercise-31', 'Overflow')).toBe(false)
  expect(Object.keys(chatDrafts.get('a').draft.answers)).toHaveLength(30)
  chatDrafts.edit('a', { text: 'Still valid' })
  await chatDrafts.flush('a')
  expect(chatDrafts.get('a').dirty).toBe(false)
  expect(chatDrafts.editAnswer('a', 'exercise-0', '')).toBe(true)
  expect(chatDrafts.editAnswer('a', 'exercise-31', 'Replacement')).toBe(true)
  expect(chatDrafts.get('a').draft.answers).not.toHaveProperty('exercise-0')
})
it('does not restore a retired answer when a concurrent send acknowledgement arrives', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  chatDrafts.edit('a', { text: 'Question', answers: { exercise: 'Captured answer' } })
  const response = deferred<Awaited<ReturnType<typeof chatsApi.send>>>()
  const send = vi.spyOn(chatsApi, 'send').mockReturnValue(response.promise)
  const sending = chatDrafts.send('a', 'en')
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  chatDrafts.retireAnswer('a', 'exercise', 'Captured answer')
  vi.mocked(chatsApi.draft).mockResolvedValue({
    ...empty(2),
    answers: { exercise: 'Captured answer' },
  })
  response.resolve({ conversation_id: 'a', generation: { id: 'gen' } as never })
  await sending
  expect(chatDrafts.get('a').draft.answers).not.toHaveProperty('exercise')
})

it('releases a rejected historical practice pending command while preserving the ordinary question', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, d) => ({
    ...d,
    revision: d.revision + 1,
  }))
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'My ordinary question' })
  const entry = chatDrafts.get('a')
  useChatStore.setState((s) => ({
    entries: {
      ...s.entries,
      a: {
        ...entry,
        pending: {
          selectionVersion: s.selectionVersion,
          snapshot: entry.draft,
          command: {
            operation_id: 'old-command',
            conversation_id: 'a',
            draft_revision: entry.draft.revision,
            kind: 'exercise',
            exercise_kind: 'gap',
          },
        },
      },
    },
  }))
  vi.spyOn(chatsApi, 'send').mockRejectedValueOnce(new ApiError(409, 'practice_disabled'))
  await expect(chatDrafts.send('a', 'en')).rejects.toThrow()
  expect(chatDrafts.get('a').pending).toBeNull()
  expect(chatDrafts.get('a').draft.text).toBe('My ordinary question')
})

it('fences sends by pending citation owner while leaving other drafts usable', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, draft) => ({
    ...draft,
    revision: draft.revision + 1,
  }))
  const send = vi
    .spyOn(chatsApi, 'send')
    .mockResolvedValue({ conversation_id: 'b', generation: { id: 'g' } as never })
  await chatDrafts.load('a')
  await chatDrafts.load('b')
  chatDrafts.edit('a', { text: 'Question A' })
  chatDrafts.edit('b', { text: 'Question B' })
  const token = chatDrafts.beginCitation('a', { text: 'Quote', lesson: 'lesson', source: 1 })!
  await expect(chatDrafts.send('a', 'en')).rejects.toThrow('Citation preparation pending')
  expect(send).not.toHaveBeenCalled()
  await chatDrafts.send('b', 'en')
  expect(send).toHaveBeenCalledTimes(1)
  expect(chatDrafts.ownsCitation('a', token)).toBe(true)
  chatDrafts.completeCitation('a', token, 'citation')
  expect(chatDrafts.get('a').draft.text).toContain('```\ncitation\n```')
  expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
  await chatDrafts.send('a', 'en')
  expect(send).toHaveBeenCalledTimes(2)
})

it('releases cancelled preparation and rejects late completion into the next draft', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, draft) => ({
    ...draft,
    revision: draft.revision + 1,
  }))
  vi.spyOn(chatsApi, 'send').mockResolvedValue({
    conversation_id: 'a',
    generation: { id: 'g' } as never,
  })
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Question' })
  const token = chatDrafts.beginCitation('a', { text: 'Quote', lesson: 'lesson', source: 1 })!
  chatDrafts.cancelCitation('a', token)
  await chatDrafts.send('a', 'en')
  chatDrafts.edit('a', { text: 'Next question' })
  const next = chatDrafts.beginCitation('a', { text: 'Next quote', lesson: 'lesson', source: 1 })!
  chatDrafts.completeCitation('a', token, 'late')
  chatDrafts.cancelCitation('a', token)
  expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
  expect(chatDrafts.ownsCitation('a', next)).toBe(true)
  chatDrafts.completeCitation('a', next, 'current')
  expect(chatDrafts.get('a').draft.text).toBe('Next question\n\n```\ncurrent\n```\n\n')
  expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
})

it.each(['remove', 'identity', 'reload'] as const)(
  'invalidates pending citation on %s',
  async (change) => {
    vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
    await chatDrafts.load('a')
    const token = chatDrafts.beginCitation('a', { text: 'Quote', lesson: 'lesson', source: 1 })!
    if (change === 'remove') chatDrafts.remove('a')
    if (change === 'identity') {
      chatDrafts.setUser(null)
      chatDrafts.setUser('u1')
    }
    if (change === 'reload') chatDrafts.restoreSession()
    chatDrafts.completeCitation('a', token, 'late')
    expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
    expect(chatDrafts.ownsCitation('a', token)).toBe(false)
  },
)

it('does not start citation preparation during a send or uncertain acknowledgement', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, draft) => ({
    ...draft,
    revision: draft.revision + 1,
  }))
  vi.spyOn(chatsApi, 'send').mockRejectedValue(new Error('Lost acknowledgement'))
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Question' })
  const sending = chatDrafts.send('a', 'en')
  const preview = { text: 'Quote', lesson: 'lesson', source: 1 }
  expect(chatDrafts.beginCitation('a', preview)).toBeNull()
  await expect(sending).rejects.toThrow('Lost acknowledgement')
  expect(chatDrafts.beginCitation('a', preview)).toBeNull()
  expect(chatDrafts.get('a').pending).not.toBeNull()
})

it('inserts a verified paragraph as editable fenced text preserving the latest question', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: 'Initial question' })
  const token = chatDrafts.beginCitation('a', { text: 'Preview', lesson: 'lesson', source: 1 })!
  chatDrafts.edit('a', { text: 'Latest question' })
  chatDrafts.completeCitation('a', token, 'Full paragraph.  Exact spacing!')
  expect(chatDrafts.get('a').draft.text).toBe(
    'Latest question\n\n```\nFull paragraph.  Exact spacing!\n```\n\n',
  )
  expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
})

it('rejects quote-only drafts at the store boundary while accepting the question outside fences', async () => {
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(empty())
  const send = vi.spyOn(chatsApi, 'send')
  await chatDrafts.load('a')
  chatDrafts.edit('a', { text: '````\nQuoted ``` text\n````\n\n' })
  await expect(chatDrafts.send('a', 'en')).rejects.toThrow('Question required')
  expect(send).not.toHaveBeenCalled()
})
