import { waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { chatsApi, type Citation, type ChatDraft } from '@/api/chats'
import { chatDrafts, useChatStore } from './chatStore'
const legacy: ChatDraft = {
  revision: 2,
  text: 'Question?',
  citation_ids: ['c'],
  exercise_id: null,
  attempt_id: null,
  answers: {},
}
const snapshot = {
  id: 'c',
  context_text: 'Full frozen paragraph.  Exact spacing!',
  selected_text: 'paragraph',
} as Citation
const inline = 'Question?\n\n```\nFull frozen paragraph.  Exact spacing!\n```\n\n'
beforeEach(() => {
  vi.restoreAllMocks()
  chatDrafts.setUser(null)
  sessionStorage.clear()
  chatDrafts.setUser('migration-user')
  vi.spyOn(chatsApi, 'draft').mockResolvedValue(legacy)
  vi.spyOn(chatsApi, 'citation').mockResolvedValue(snapshot)
  vi.spyOn(chatsApi, 'saveDraft').mockImplementation(async (_, draft) => ({
    ...draft,
    revision: draft.revision + 1,
  }))
})
it('converts frozen full contexts once, saves with CAS and reloads without hidden attachments', async () => {
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft).toMatchObject({ text: inline, citation_ids: [], revision: 2 })
  await chatDrafts.flush('a')
  expect(chatsApi.saveDraft).toHaveBeenCalledWith(
    'a',
    expect.objectContaining({ text: inline, citation_ids: [], revision: 2 }),
  )
  vi.mocked(chatsApi.draft).mockResolvedValue(chatDrafts.get('a').draft)
  chatDrafts.restoreSession()
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft.text).toBe(inline)
  expect(chatsApi.citation).toHaveBeenCalledTimes(1)
})
it('preserves edits during conversion and retains IDs on recoverable snapshot failure', async () => {
  let fail!: (error: Error) => void
  vi.mocked(chatsApi.citation).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject
    }),
  )
  const loading = chatDrafts.load('a')
  await waitFor(() => expect(chatsApi.citation).toHaveBeenCalledTimes(1))
  chatDrafts.edit('a', { text: 'Latest question' })
  fail(new Error('Snapshot unavailable'))
  await expect(loading).rejects.toThrow('Snapshot unavailable')
  expect(chatDrafts.get('a')).toMatchObject({
    loaded: false,
    draft: { text: 'Latest question', citation_ids: ['c'] },
  })
  await expect(chatDrafts.send('a', 'en')).rejects.toThrow('Draft conversion required')
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft.text).toBe(inline.replace('Question?', 'Latest question'))
  expect(chatDrafts.get('a').draft.citation_ids).toEqual([])
})
it.each(['server', 'local'] as const)(
  'converts only the chosen %s conflict version',
  async (choice) => {
    vi.mocked(chatsApi.draft).mockResolvedValue({ ...legacy, citation_ids: [] })
    await chatDrafts.load('a')
    chatDrafts.edit('a', { text: 'Local question', citation_ids: ['c'] })
    chatDrafts.restoreSession()
    vi.mocked(chatsApi.draft).mockResolvedValue({ ...legacy, revision: 8, text: 'Remote question' })
    await chatDrafts.load('a')
    expect(chatsApi.citation).not.toHaveBeenCalled()
    expect(chatDrafts.get('a').conflict).not.toBeNull()
    chatDrafts.resolve('a', choice)
    await waitFor(() => expect(chatDrafts.get('a').draft.citation_ids).toEqual([]))
    expect(chatDrafts.get('a').draft.text).toBe(
      inline.replace('Question?', choice === 'server' ? 'Remote question' : 'Local question'),
    )
    await waitFor(() =>
      expect(chatsApi.saveDraft).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ revision: 8, citation_ids: [] }),
      ),
    )
  },
)
it('fences a delayed snapshot conversion when the user changes', async () => {
  let finish!: (value: Citation) => void
  vi.mocked(chatsApi.citation).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const loading = chatDrafts.load('a')
  await waitFor(() => expect(chatsApi.citation).toHaveBeenCalledTimes(1))
  chatDrafts.setUser('other-user')
  finish(snapshot)
  await expect(loading).rejects.toThrow('Chat identity changed')
  expect(chatDrafts.get('a').draft.text).toBe('')
  expect(chatsApi.saveDraft).not.toHaveBeenCalled()
})
it('leaves uncertain legacy sends immutable and reuses the original operation', async () => {
  const pending = {
    selectionVersion: 0,
    command: {
      operation_id: 'original-op',
      conversation_id: 'a',
      draft_revision: 2,
      kind: 'reply' as const,
      exercise_kind: null,
    },
    snapshot: legacy,
  }
  useChatStore.setState({ entries: { a: { ...chatDrafts.get('a'), draft: legacy, pending } } })
  await chatDrafts.load('a')
  expect(chatsApi.citation).not.toHaveBeenCalled()
  expect(chatDrafts.get('a').pending).toEqual(pending)
  const send = vi.spyOn(chatsApi, 'send').mockImplementation(async () => {
    vi.mocked(chatsApi.draft).mockResolvedValue({
      ...legacy,
      revision: 3,
      text: '',
      citation_ids: [],
    })
    return { conversation_id: 'a', generation: { id: 'g' } as never }
  })
  await chatDrafts.send('a', 'en')
  expect(send).toHaveBeenCalledWith(pending.command)
  expect(chatsApi.saveDraft).not.toHaveBeenCalled()
  expect(chatsApi.citation).not.toHaveBeenCalled()
  expect(chatDrafts.get('a').pending).toBeNull()
})
it('keeps oversized legacy quotes intact until the question is shortened and retried', async () => {
  vi.mocked(chatsApi.draft).mockResolvedValue({ ...legacy, text: 'Q'.repeat(16000) })
  await expect(chatDrafts.load('a')).rejects.toThrow('inline_quote_too_large')
  expect(chatDrafts.get('a').draft.citation_ids).toEqual(['c'])
  expect(chatDrafts.get('a').draft.text).toHaveLength(16000)
  chatDrafts.edit('a', { text: 'Short question' })
  await chatDrafts.load('a')
  expect(chatDrafts.get('a').draft.text).toBe(inline.replace('Question?', 'Short question'))
})

it('converts a legacy draft once a definitive retry rejection releases the old operation', async () => {
  const pending = {
    selectionVersion: 0,
    command: {
      operation_id: 'original-op',
      conversation_id: 'a',
      draft_revision: 2,
      kind: 'reply' as const,
      exercise_kind: null,
    },
    snapshot: legacy,
  }
  useChatStore.setState({ entries: { a: { ...chatDrafts.get('a'), draft: legacy, pending } } })
  await chatDrafts.load('a')
  vi.spyOn(chatsApi, 'send').mockRejectedValue(new ApiError(409, 'source_unavailable'))
  await expect(chatDrafts.send('a', 'en')).rejects.toThrow('source_unavailable')
  await waitFor(() => expect(chatDrafts.get('a').draft.citation_ids).toEqual([]))
  expect(chatDrafts.get('a').draft.text).toBe(inline)
  expect(chatDrafts.get('a').pending).toBeNull()
})
