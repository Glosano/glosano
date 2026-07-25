import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', () => ({
  reviewApi: { queue: vi.fn(), answer: vi.fn(), counts: vi.fn() },
}))

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, className, to }: { children?: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to}>{children}</a>
  ),
}))

import type { ReviewMode } from '@/api/review'
import { reviewApi } from '@/api/review'
import { ReviewPage } from './ReviewPage'

function renderPage({ lessonId, mode }: { lessonId?: string; mode?: ReviewMode } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={qc}>
      <ReviewPage lang="pt" lessonId={lessonId} mode={mode} />
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
    renderPage({ mode: 'cards' })
    expect(await screen.findByText('Всё повторено')).toBeTruthy()
  })

  it('пустая очередь урока предлагает повторить весь словарь', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage({ lessonId: 'L1', mode: 'cards' })
    expect(await screen.findByText('В этом уроке пока нет слов')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Повторить весь словарь/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/learn/$lang/review')
  })

  it('shows limit reached state', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({
      items: [],
      daily: { limit: 20, done_today: 20, limit_reached: true },
    })
    renderPage({ mode: 'cards' })
    expect(await screen.findByText('Дневной лимит достигнут')).toBeTruthy()
  })

  it('shows error state on queue failure', async () => {
    vi.mocked(reviewApi.queue).mockRejectedValue(new Error('boom'))
    renderPage({ mode: 'cards' })
    expect(await screen.findByText('Не удалось загрузить очередь')).toBeTruthy()
  })

  it('renders first card and progress counter when queue has items', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage({ mode: 'cards' })
    expect(await screen.findByText('cada')).toBeTruthy()
    expect(screen.getByText('1 / 1')).toBeTruthy()
  })

  it('с lessonId и mode=cards грузит очередь урока', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    renderPage({ lessonId: 'L1', mode: 'cards' })
    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', undefined))
    expect(await screen.findByText('Слова урока')).toBeTruthy()
  })

  it('с lessonId и mode=new грузит очередь урока', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage({ lessonId: 'L1', mode: 'new' })
    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', 'new'))
  })

  it('с lessonId и mode=cloze грузит очередь урока', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage({ lessonId: 'L1', mode: 'cloze' })
    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', undefined))
  })

  it('с lessonId и mode=translation грузит очередь урока', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderPage({ lessonId: 'L1', mode: 'translation' })
    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', 'practice'))
  })
})

const ITEM2 = { ...ITEM, review_item_id: 'R2', item_id: 'I2', text: 'mundo', translation: 'мир' }

describe('ReviewPage session flow (cards mode)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip -> GradeBar click -> next card -> final screen with stats', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM, ITEM2], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage({ mode: 'cards' })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^5/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 5))
    expect(await screen.findByText('mundo')).toBeTruthy()
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^2/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R2', 2))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(screen.getByText('Средняя оценка: 3.5')).toBeTruthy()
    expect(screen.getByText(/Повторите ещё раз: mundo — мир/)).toBeTruthy()
    expect(screen.queryByText(/Повторите ещё раз: cada/)).toBeNull()
  })

  it('keyboard: Space flips, 4 grades the card', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage({ mode: 'cards' })
    await screen.findByText('cada')
    fireEvent.keyDown(window, { key: ' ' })
    expect(await screen.findByRole('button', { name: /^4/ })).toBeTruthy()
    fireEvent.keyDown(window, { key: '4' })
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 4))
  })

  it('failed answer keeps card and shows retryable error', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      new_confidence: 2, new_status: 'tracked', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage({ mode: 'cards' })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^4/ }))
    expect(await screen.findByText('Не удалось сохранить ответ')).toBeTruthy()
    expect(screen.getByText('cada')).toBeTruthy() // карточка осталась
    fireEvent.click(screen.getByRole('button', { name: /^4/ })) // retry
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
    const { qc } = renderPage({ mode: 'cards' })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^4/ }))
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
    renderPage({ mode: 'cards' })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^5/ }))
    expect(await screen.findByText('Слово выучено ✓')).toBeTruthy()
  })

  it('restart clears a stale graduation toast so it does not leak into the new session', async () => {
    vi.mocked(reviewApi.queue)
      .mockResolvedValueOnce({ items: [ITEM], daily: DAILY })
      .mockResolvedValueOnce({ items: [ITEM2], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: null, new_status: 'known', due_at: '2026-07-21T12:00:00Z', done_today: 1,
    })
    renderPage({ mode: 'cards' })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать перевод' }))
    fireEvent.click(screen.getByRole('button', { name: /^5/ }))
    expect(await screen.findByText('Слово выучено ✓')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Повторить ошибки' }))

    expect(await screen.findByText('mundo')).toBeTruthy()
    expect(screen.queryByText('Слово выучено ✓')).toBeNull()
  })
})

describe('ReviewPage mode select', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders ModeSelect with tiles and counts when no mode is given', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: true })
    renderPage({})
    expect(await screen.findByText('Карточки')).toBeTruthy()
    expect(screen.getByText('Новые слова')).toBeTruthy()
    expect(reviewApi.queue).not.toHaveBeenCalled()
  })

  it('с lessonId без mode показывает выбор режима в скоупе урока', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 2, new: 1, practice: 0, ai_enabled: true })
    renderPage({ lessonId: 'L1' })
    expect(await screen.findByText('Слова урока')).toBeInTheDocument()
    expect(reviewApi.queue).not.toHaveBeenCalled()
  })
})
