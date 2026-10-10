import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: {
    counts: vi.fn(),
    selectedQueue: vi.fn(),
    queue: vi.fn(),
    answer: vi.fn(),
    exercise: vi.fn(),
    exerciseFeedback: vi.fn(),
  },
}))
const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigateMock,
}))

import { reviewApi } from '@/api/review'
import { ModeSelect } from './ModeSelect'

function renderModeSelect(lessonId?: string, itemKind?: 'token' | 'phrase') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <ModeSelect lang="pt" lessonId={lessonId} itemKind={itemKind} />
      </QueryClientProvider>,
    ),
  }
}

describe('ModeSelect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows tiles with counts and navigates on click', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: true })
    renderModeSelect()
    expect(await screen.findByText('Карточки')).toBeTruthy()
    expect(screen.getAllByText('Доступно: 3 · В занятии: 3')).toHaveLength(1)
    screen.getByText('Новые слова').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ mode: 'new' }) }),
    )
  })

  it('disables AI modes when ai is off', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({
      due: 3,
      new: 2,
      practice: 1,
      ai_enabled: false,
    })
    renderModeSelect()
    await screen.findByText('Карточки')
    const newTile = screen.getByText('Новые слова').closest('button') as HTMLButtonElement
    expect(newTile.disabled).toBe(true)
    expect(screen.getAllByText('AI отключён').length).toBeGreaterThan(0)
  })

  it('в скоупе урока запрашивает счётчики урока и сохраняет lessonId при переходе', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 2, new: 1, practice: 0, ai_enabled: true })
    renderModeSelect('L1')
    await waitFor(() => expect(reviewApi.counts).toHaveBeenCalledWith('pt', 'L1', undefined))
    expect(await screen.findByText('Слова урока')).toBeTruthy()
    screen.getByText('Карточки').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: { mode: 'cards', lessonId: 'L1' } }),
    )
  })

  it('с kind=phrase считает только фразы и сохраняет kind при переходе', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 1, new: 1, practice: 0, ai_enabled: true })
    renderModeSelect(undefined, 'phrase')
    await waitFor(() => expect(reviewApi.counts).toHaveBeenCalledWith('pt', undefined, 'phrase'))
    expect(await screen.findByText('Фразы')).toBeTruthy()
    screen.getByText('Карточки').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: { mode: 'cards', kind: 'phrase' } }),
    )
  })

  it('refreshes the cached completion before returning from the chooser', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 2, new: 1, practice: 0, ai_enabled: true })
    const { qc } = renderModeSelect('L1')
    qc.setQueryData(['lesson', 'L1'], { completion_action_id: 'old-action' })
    await screen.findByText('Карточки')
    screen.getByRole('button', { name: 'К итогам материала' }).click()
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/learn/$lang/lessons/$lessonId',
        params: { lang: 'pt', lessonId: 'L1' },
        search: {},
      }),
    )
    expect(qc.getQueryState(['lesson', 'L1'])?.isInvalidated).toBe(true)
  })
})
