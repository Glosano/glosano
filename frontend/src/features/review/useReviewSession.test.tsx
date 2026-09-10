import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: {
    counts: vi.fn(),
    queue: vi.fn(),
    answer: vi.fn(),
    exercise: vi.fn(),
    exerciseFeedback: vi.fn(),
  },
}))

import { reviewApi } from '@/api/review'
import { useReviewSession } from './useReviewSession'

const ITEM = {
  review_item_id: 'R1',
  item_kind: 'token' as const,
  item_id: 'I1',
  text: 'cada',
  confidence: 1,
  translation: 'каждый',
  notes: null,
  context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }

// QueryClient создаётся один раз на вызов renderSession: wrapper — обычный
// компонент и переисполняется на каждый рендер, поэтому клиент должен жить
// в замыкании снаружи, а не создаваться внутри wrapper заново.
function renderSession(statuses: string[], opts: { lessonId?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const hook = renderHook(
    () => {
      const s = useReviewSession('pt', { serverMode: 'due', ...opts })
      statuses.push(s.status)
      return s
    },
    {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    },
  )
  return { ...hook, qc }
}

describe('useReviewSession status (регресс: isPending/session race)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('не отдаёт "empty" транзитом, пока непустая очередь урока ещё не засеяна в сессию', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    const statuses: string[] = []
    renderSession(statuses, { lessonId: 'L1' })

    await waitFor(() => expect(statuses).toContain('active'))
    expect(statuses).not.toContain('empty')
  })

  it('действительно пустая очередь по-прежнему отдаёт "empty"', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    const statuses: string[] = []
    renderSession(statuses, { lessonId: 'L1' })

    await waitFor(() => expect(statuses).toContain('empty'))
  })

  it('успешный ответ обновляет vocabulary views без перезапуска активной очереди', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
    const statuses: string[] = []
    const { result, qc } = renderSession(statuses, { lessonId: 'L1' })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    await waitFor(() => expect(result.current.status).toBe('active'))

    result.current.grade(4)

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reader-vocabulary'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['word-card'] })
    expect(reviewApi.queue).toHaveBeenCalledTimes(1)
  })
})
