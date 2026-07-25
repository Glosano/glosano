import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewApi: { counts: vi.fn(), queue: vi.fn(), answer: vi.fn(), exercise: vi.fn(), exerciseFeedback: vi.fn() },
}))

// Пустой экран в скоупе урока рендерит <Link> из tanstack router (LessonEmptyState).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children?: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to}>{children}</a>
  ),
}))

import { reviewApi } from '@/api/review'
import { TranslationSession } from './TranslationSession'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 4, translation: 'каждый', notes: null, context_sentence: null,
}
const DAILY = { limit: 20, done_today: 0, limit_reached: false }

function renderSession(lessonId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TranslationSession lang="pt" lessonId={lessonId} />
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

  it('в скоупе урока показывает подзаголовок "Слова урока" и передаёт lessonId в очередь', async () => {
    renderSession('L1')
    await waitFor(() => expect(reviewApi.queue).toHaveBeenCalledWith('pt', 'L1', 'practice'))
    expect(await screen.findByText(/Слова урока/)).toBeTruthy()
  })

  it('пустая очередь урока показывает lesson-пустой экран со ссылкой на общий словарь', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderSession('L1')
    expect(await screen.findByText('В этом уроке пока нет слов')).toBeInTheDocument()
    expect(
      screen.queryByText('Нет предложений для практики'),
    ).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Повторить весь словарь/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/learn/$lang/review')
  })

  it('пустая очередь вне скоупа урока показывает старый нейтральный текст', async () => {
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [], daily: DAILY })
    renderSession()
    expect(await screen.findByText('Нет предложений для практики')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Повторить весь словарь/ })).not.toBeInTheDocument()
  })
})
