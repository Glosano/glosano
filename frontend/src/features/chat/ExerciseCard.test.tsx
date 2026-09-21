import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { chatsApi, type Exercise } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { chatDrafts } from './chatStore'
import { ExerciseCard } from './ExerciseCard'
const base: Exercise = {
  id: 'ex',
  conversation_id: 'chat',
  message_id: 'message',
  kind: 'single_choice',
  prompt: 'Choose',
  options: [
    { id: 'a', text: 'Hello' },
    { id: 'b', text: 'Goodbye' },
  ],
}
beforeEach(async () => {
  vi.restoreAllMocks()
  setUiLanguage('en')
  chatDrafts.setUser(null)
  chatDrafts.setUser('user')
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
  vi.spyOn(chatsApi, 'attempts').mockResolvedValue({ items: [] })
  await chatDrafts.load('chat')
})
function show(exercise: Exercise, aiEnabled = true) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ExerciseCard exercise={exercise} aiEnabled={aiEnabled} busy={false} />
    </QueryClientProvider>,
  )
}
it('checks single choice with AI off using the server answer and retains prior attempts', async () => {
  const attempt = {
    id: 'attempt',
    exercise_id: 'ex',
    conversation_id: 'chat',
    operation_id: 'op',
    answer: 'b',
    status: 'complete' as const,
    correct: false,
    feedback: 'Try a greeting.',
    created_at: '2026-09-18T12:00:00Z',
  }
  vi.spyOn(chatsApi, 'attempt').mockImplementation(async () => {
    vi.mocked(chatsApi.attempts).mockResolvedValue({ items: [attempt] })
    return attempt
  })
  show(base, false)
  fireEvent.click(screen.getByLabelText('Goodbye'))
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await screen.findByText('Try a greeting.')
  expect(screen.getByText('Incorrect')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Hello'))
  expect(screen.getByText('Try a greeting.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Discuss this attempt' }))
  expect(chatDrafts.get('chat').draft.attempt_id).toBe('attempt')
})
it('restores an unfinished gap answer on remount without evaluating locally', async () => {
  const ex = { ...base, kind: 'gap' as const, prompt: 'Eu {{gap}} aqui.', options: undefined }
  const first = show(ex)
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), { target: { value: 'estou' } })
  first.unmount()
  await act(async () => {
    show(ex)
  })
  expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('estou')
  expect(screen.queryByText('Correct')).not.toBeInTheDocument()
})
it('keeps free response drafts usable but explains unavailable AI evaluation', async () => {
  show({ ...base, kind: 'free_response', goal: 'Greetings' }, false)
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'Bom dia' },
  })
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled()
  expect(
    screen.getByText('AI evaluation is unavailable. Your answer is saved as a draft.'),
  ).toBeInTheDocument()
})
it('shows a failed AI evaluation as ungraded and retries with a new immutable attempt', async () => {
  const failed = {
    id: 'old',
    exercise_id: 'ex',
    conversation_id: 'chat',
    operation_id: 'op',
    answer: 'Olá',
    status: 'failed' as const,
    correct: null,
    feedback: null,
    created_at: '2026-09-18T12:00:00Z',
  }
  vi.mocked(chatsApi.attempts).mockResolvedValue({ items: [failed] })
  const save = vi
    .spyOn(chatsApi, 'attempt')
    .mockResolvedValue({ ...failed, id: 'new', status: 'pending' })
  vi.spyOn(chatsApi, 'evaluate').mockResolvedValue({ id: 'gen' } as never)
  show({ ...base, kind: 'free_response' })
  await screen.findByText('Not graded — evaluation failed')
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'Bom dia' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(save.mock.calls[0]![2]).toBe('Bom dia')
  expect(screen.queryByText('Incorrect')).not.toBeInTheDocument()
  await act(async () => {})
})
it('can load the full paginated history of an old exercise', async () => {
  const records = Array.from({ length: 50 }, (_, i) => ({
    id: `attempt${i}`,
    exercise_id: 'ex',
    conversation_id: 'chat',
    operation_id: `op${i}`,
    answer: 'a',
    status: 'complete' as const,
    correct: true,
    feedback: `Feedback ${i}`,
    created_at: '2026-09-18T12:00:00Z',
  }))
  vi.mocked(chatsApi.attempts).mockImplementation(async (_c, _e, offset) => ({
    items: offset ? [{ ...records[0]!, id: 'old', feedback: 'Oldest attempt feedback' }] : records,
  }))
  show(base)
  fireEvent.click(await screen.findByRole('button', { name: 'More attempts' }))
  await screen.findByText('Oldest attempt feedback')
  expect(screen.getByText('Feedback 0')).toBeInTheDocument()
})
it('retries a lost answer acknowledgement with the same attempt operation after remount', async () => {
  const save = vi
    .spyOn(chatsApi, 'attempt')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockImplementation(async () => {
      const accepted = {
        id: 'accepted',
        exercise_id: 'ex',
        conversation_id: 'chat',
        operation_id: 'op',
        answer: 'a',
        status: 'complete' as const,
        correct: true,
        feedback: 'Accepted',
        created_at: '2026-09-18T12:00:00Z',
      }
      vi.mocked(chatsApi.attempts).mockResolvedValue({ items: [accepted] })
      return accepted
    })
  const first = show(base)
  fireEvent.click(screen.getByLabelText('Hello'))
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await screen.findByText('Could not submit your answer. Retry; your attempt is preserved.')
  first.unmount()
  await act(async () => {
    show(base)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Retry answer submission' }))
  await screen.findByText('Accepted')
  expect(save.mock.calls[0]![3]).toBe(save.mock.calls[1]![3])
})
it('does not alter or send an existing composer draft when Similar is cancelled', async () => {
  chatDrafts.edit('chat', {
    text: 'My unsent question',
    exercise_id: 'other',
    attempt_id: 'other-attempt',
  })
  const send = vi.spyOn(chatsApi, 'send')
  show(base)
  fireEvent.click(screen.getByRole('button', { name: 'Similar exercise' }))
  expect(screen.getByText('My unsent question')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(chatDrafts.get('chat').draft).toMatchObject({
    text: 'My unsent question',
    exercise_id: 'other',
    attempt_id: 'other-attempt',
  })
  expect(send).not.toHaveBeenCalled()
})

it('does not replace an unresolved send with a Similar request', async () => {
  chatDrafts.edit('chat', { text: 'Unacknowledged question' })
  vi.spyOn(chatsApi, 'send').mockRejectedValue(new Error('Lost acknowledgement'))
  await chatDrafts.send('chat', 'en').catch(() => {})
  show(base)
  expect(screen.getByRole('button', { name: 'Similar exercise' })).toBeDisabled()
})

it('retires a submitted answer at the thirty-answer boundary so the next exercise and composer can save', async () => {
  const unfinished = Object.fromEntries(
    Array.from({ length: 29 }, (_, i) => [`unfinished-${i}`, `Answer ${i}`]),
  )
  chatDrafts.edit('chat', { answers: unfinished })
  vi.spyOn(chatsApi, 'attempt').mockImplementation(async (_cid, eid, answer, operation_id) => ({
    id: `attempt-${eid}`,
    exercise_id: eid,
    conversation_id: 'chat',
    operation_id,
    answer,
    status: 'complete',
    correct: true,
    feedback: 'Checked',
    created_at: '2026-09-19T00:00:00Z',
  }))
  const first = show({ ...base, kind: 'gap', id: 'exercise-30' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'Thirtieth answer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue(''))
  first.unmount()
  await act(async () => {
    show({ ...base, kind: 'gap', id: 'exercise-31' })
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'Thirty-first answer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue(''))
  await act(async () => {
    chatDrafts.edit('chat', { text: 'Composer still saves' })
    await chatDrafts.flush('chat')
  })
  expect(chatDrafts.get('chat').draft).toMatchObject({
    text: 'Composer still saves',
    answers: unfinished,
  })
  const saved = vi.mocked(chatsApi.saveDraft).mock.calls.at(-1)![1]
  expect(saved.text).toBe('Composer still saves')
  expect(Object.keys(saved.answers)).toHaveLength(29)
})
it('keeps a newer raw answer typed while submission is in flight', async () => {
  let resolve!: (v: Awaited<ReturnType<typeof chatsApi.attempt>>) => void
  const submit = vi.spyOn(chatsApi, 'attempt').mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )
  show({ ...base, kind: 'gap' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'Old raw answer ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
  await waitFor(() => expect(submit).toHaveBeenCalled())
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
    target: { value: 'New raw answer' },
  })
  await act(async () =>
    resolve({
      id: 'accepted',
      exercise_id: 'ex',
      conversation_id: 'chat',
      operation_id: 'op',
      answer: 'Old raw answer ',
      status: 'complete',
      correct: true,
      feedback: 'Checked',
      created_at: '2026-09-19T00:00:00Z',
    }),
  )
  expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('New raw answer')
  expect(chatDrafts.get('chat').draft.answers.ex).toBe('New raw answer')
})
it('explains the unfinished-answer limit and clearing an existing draft frees a slot', async () => {
  chatDrafts.edit('chat', {
    answers: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`exercise-${i}`, `Answer ${i}`]),
    ),
  })
  const full = show({ ...base, kind: 'gap', id: 'exercise-31' })
  expect(screen.getByRole('textbox', { name: 'Answer' })).toBeDisabled()
  expect(
    screen.getByText(
      'You have 30 unfinished answers. Submit or clear an existing answer to start another.',
    ),
  ).toBeInTheDocument()
  full.unmount()
  let existing: ReturnType<typeof show> | undefined
  await act(async () => {
    existing = show({ ...base, kind: 'gap', id: 'exercise-0' })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clear answer draft' }))
  expect(chatDrafts.get('chat').draft.answers).not.toHaveProperty('exercise-0')
  existing!.unmount()
  await act(async () => {
    show({ ...base, kind: 'gap', id: 'exercise-31' })
  })
  const input = screen.getByRole('textbox', { name: 'Answer' })
  expect(input).toBeEnabled()
  fireEvent.change(input, { target: { value: 'New answer' } })
  expect(chatDrafts.get('chat').draft.answers['exercise-31']).toBe('New answer')
  expect(Object.keys(chatDrafts.get('chat').draft.answers)).toHaveLength(30)
})
