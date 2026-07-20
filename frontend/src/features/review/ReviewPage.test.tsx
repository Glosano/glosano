import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', () => ({
  reviewApi: { queue: vi.fn(), answer: vi.fn() },
}))

import { reviewApi } from '@/api/review'
import { ReviewPage } from './ReviewPage'

function renderPage(lessonId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReviewPage lang="pt" lessonId={lessonId} />
    </QueryClientProvider>,
  )
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
