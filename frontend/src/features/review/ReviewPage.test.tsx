import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', () => ({
  reviewApi: { queue: vi.fn(), answer: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { ReviewPage } from './ReviewPage'

function renderPage(lessonId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={qc}>
      <ReviewPage lang="pt" lessonId={lessonId} />
    </QueryClientProvider>,
  )
  return { ...result, qc }
}

const DAILY = { limit: 20, done_today: 0, limit_reached: false }
const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: null,
  context_sentence: null,
}

describe('ReviewPage queue states', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when queue is empty', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage()
    expect(await screen.findByText('Всё повторено')).toBeTruthy()
  })

  it('shows limit reached state', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({
      items: [],
      daily: { limit: 20, done_today: 20, limit_reached: true },
    })
    renderPage()
    expect(await screen.findByText('Дневной лимит достигнут')).toBeTruthy()
  })

  it('shows error state on queue failure', async () => {
    vi.mocked(reviewApi.queue).mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Не удалось загрузить очередь')).toBeTruthy()
  })

  it('renders first card and progress counter when queue has items', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage()
    expect(await screen.findByText('cada')).toBeTruthy()
    expect(screen.getByText('1 / 1')).toBeTruthy()
  })

  it('passes lessonId to queue and shows lesson subtitle', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage('L1')
    expect(await screen.findByText('Слова урока')).toBeTruthy()
    expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1')
  })
})

const ITEM2 = { ...ITEM, review_item_id: 'R2', item_id: 'I2', text: 'mundo', translation: 'мир' }

describe('ReviewPage session flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip -> correct answer -> next card -> final screen', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM, ITEM2], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 'correct'))
    expect(await screen.findByText('mundo')).toBeTruthy()
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✗ Ошибка' }))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(screen.getByText('Верно: 1 · Ошибки: 1')).toBeTruthy()
  })

  it('keyboard: Space flips, 2 answers correct', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    await screen.findByText('cada')
    fireEvent.keyDown(window, { key: ' ' })
    expect(await screen.findByRole('button', { name: '✓ Знаю' })).toBeTruthy()
    fireEvent.keyDown(window, { key: '2' })
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 'correct'))
  })

  it('failed answer keeps card and shows retryable error', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(await screen.findByText('Не удалось сохранить ответ')).toBeTruthy()
    expect(screen.getByText('cada')).toBeTruthy() // карточка осталась
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' })) // retry
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
  })

  it('restart after completion refetches queue and seeds a fresh session (restart race regression)', async () => {
    const ITEM3 = { ...ITEM, review_item_id: 'R3', item_id: 'I3', text: 'agua', translation: 'вода' }
    vi.mocked(reviewApi.queue)
      .mockResolvedValueOnce({ items: [ITEM], daily: DAILY })
      .mockResolvedValueOnce({ items: [ITEM3], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    const { qc } = renderPage()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(reviewApi.queue).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Повторить ошибки' }))

    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('agua')).toBeTruthy()
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['reader-statuses'] }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['vocab-list'] }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['phrases'] }),
    )
  })

  it('shows graduation toast when answer graduates the item to known (spec §6)', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: null, new_status: 'known', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(await screen.findByText('Слово выучено ✓')).toBeTruthy()
  })

  it('restart clears a stale graduation toast so it does not leak into the new session', async () => {
    vi.mocked(reviewApi.queue)
      .mockResolvedValueOnce({ items: [ITEM], daily: DAILY })
      .mockResolvedValueOnce({ items: [ITEM2], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: null, new_status: 'known', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(await screen.findByText('Слово выучено ✓')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить ошибки' }))

    expect(await screen.findByText('mundo')).toBeTruthy()
    expect(screen.queryByText('Слово выучено ✓')).toBeNull()
  })
})
