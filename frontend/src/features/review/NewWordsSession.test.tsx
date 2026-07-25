import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

// SessionStates рендерит <Link> из tanstack router на переходном empty-состоянии
// сессии (session === null сразу после загрузки очереди), поэтому нужен стаб
// с router-контекстом даже там, где сам экран это не проверяет.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children?: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to}>{children}</a>
  ),
}))

import { reviewApi } from '@/api/review'
import { NewWordsSession } from './NewWordsSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const EXAMPLE = {
  payload: {
    sentence: 'Cada dia é único.', sentence_translation: 'Каждый день уникален.',
    base_form: 'cada', base_form_translation: 'каждый',
  },
  model: 'm', latency_ms: 5,
}

function renderSession() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NewWordsSession lang="pt" />
    </QueryClientProvider>,
  )
}

describe('NewWordsSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads example, reveals translation, grades', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(EXAMPLE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderSession()
    expect(await screen.findByText('Cada dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'example', review_item_id: 'R1' })
    expect(screen.queryByText('Каждый день уникален.')).toBeNull() // до раскрытия
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    expect(await screen.findByText('Каждый день уникален.')).toBeTruthy()
    expect(screen.getByText(/cada → каждый/)).toBeTruthy() // начальная форма
    fireEvent.click(screen.getByRole('button', { name: /4.*С заминкой/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 4))
  })

  it('generation failure offers retry and skip', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockRejectedValue(new Error('502'))
    renderSession()
    expect(await screen.findByText('Не удалось сгенерировать упражнение')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(reviewApi.answer).not.toHaveBeenCalled() // пропуск не пишет событие
  })

  it('в скоупе урока на финальном экране кнопка "Пройти ещё раз", а не "Повторить ошибки"', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(EXAMPLE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <NewWordsSession lang="pt" lessonId="L1" />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^2/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 2))
    expect(await screen.findByRole('button', { name: 'Пройти ещё раз' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Повторить ошибки' })).toBeNull()
  })
})
