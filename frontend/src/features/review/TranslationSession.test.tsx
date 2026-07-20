import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { TranslationSession } from './TranslationSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 4, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }

function renderSession() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TranslationSession lang="pt" />
    </QueryClientProvider>,
  )
}

describe('TranslationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue({
      payload: { sentence_translation: 'Каждый день уникален.' }, model: 'm', latency_ms: 5,
    })
    vi.mocked(reviewApi.exerciseFeedback).mockResolvedValue({
      feedback: 'Хорошо. Пропущена диакритика в único.',
    })
  })

  it('shows sentence, sends user translation, renders feedback, no SRS writes', async () => {
    renderSession()
    expect(await screen.findByText('Каждый день уникален.')).toBeTruthy()
    expect(reviewApi.queue).toHaveBeenCalledWith('pt', undefined, 'practice')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cada dia e unico.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    await waitFor(() =>
      expect(reviewApi.exerciseFeedback).toHaveBeenCalledWith({
        review_item_id: 'R1',
        sentence_translation: 'Каждый день уникален.',
        user_text: 'Cada dia e unico.',
      }),
    )
    expect(await screen.findByText(/Пропущена диакритика/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
    expect(await screen.findByText('Практика завершена')).toBeTruthy()
    expect(reviewApi.answer).not.toHaveBeenCalled()
  })
})
