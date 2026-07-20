import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { QuizSession } from './QuizSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const CLOZE = {
  payload: {
    sentence_with_gap: '___ dia é único.',
    sentence_translation: 'Каждый день уникален.',
    options: [
      { text: 'Todo', is_correct: false },
      { text: 'Cada', is_correct: true },
      { text: 'Muito', is_correct: false },
      { text: 'Pouco', is_correct: false },
    ],
  },
  model: 'm', latency_ms: 5,
}

function renderQuiz(kind: 'cloze' | 'reverse' = 'cloze') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <QuizSession lang="pt" kind={kind} />
    </QueryClientProvider>,
  )
}

describe('QuizSession (cloze)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(CLOZE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
  })

  it('correct option shows feedback then grade bar posts quality', async () => {
    renderQuiz()
    expect(await screen.findByText('___ dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'cloze', review_item_id: 'R1' })
    // до выбора GradeBar нет
    expect(screen.queryByRole('button', { name: /5.*Идеально/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cada' }))
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /5.*Идеально/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 5))
  })

  it('wrong option reveals the correct answer', async () => {
    renderQuiz()
    fireEvent.click(await screen.findByRole('button', { name: 'Todo' }))
    expect(await screen.findByText(/❌ Правильный ответ: Cada/)).toBeTruthy()
    // варианты заблокированы после выбора
    const opt = screen.getByRole('button', { name: 'Muito' }) as HTMLButtonElement
    expect(opt.disabled).toBe(true)
  })

  it('option hotkeys 1..4 select the option', async () => {
    renderQuiz()
    await screen.findByText('___ dia é único.')
    fireEvent.keyDown(window, { key: '2' }) // второй вариант = Cada
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
  })
})
