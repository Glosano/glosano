import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))
const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigateMock,
}))

import { reviewApi } from '@/api/review'
import { ModeSelect } from './ModeSelect'

function renderModeSelect(lessonId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ModeSelect lang="pt" lessonId={lessonId} />
    </QueryClientProvider>,
  )
}

describe('ModeSelect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows tiles with counts and navigates on click', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: true })
    renderModeSelect()
    expect(await screen.findByText('Карточки')).toBeTruthy()
    // due count — Карточки/Квиз-пропуск/Квиз-перевод все берут count из due, поэтому
    // "3" встречается несколько раз: скоупим проверку к плитке "Карточки".
    const cardsTile = screen.getByText('Карточки').closest('button') as HTMLButtonElement
    expect(within(cardsTile).getByText('3')).toBeTruthy()
    screen.getByText('Новые слова').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ mode: 'new' }) }),
    )
  })

  it('disables AI modes when ai is off', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 3, new: 2, practice: 1, ai_enabled: false })
    renderModeSelect()
    await screen.findByText('Карточки')
    const newTile = screen.getByText('Новые слова').closest('button') as HTMLButtonElement
    expect(newTile.disabled).toBe(true)
    expect(screen.getAllByText('AI отключён').length).toBeGreaterThan(0)
  })

  it('в скоупе урока запрашивает счётчики урока и сохраняет lessonId при переходе', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({ due: 2, new: 1, practice: 0, ai_enabled: true })
    renderModeSelect('L1')
    await waitFor(() => expect(reviewApi.counts).toHaveBeenCalledWith('pt', 'L1'))
    expect(await screen.findByText('Слова урока')).toBeTruthy()
    screen.getByText('Карточки').closest('button')!.click()
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: { mode: 'cards', lessonId: 'L1' } }),
    )
  })
})
