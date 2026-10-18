import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// SessionStates рендерит <Link> из tanstack router на переходном empty-состоянии
// сессии (session === null сразу после загрузки очереди), поэтому нужен стаб
// с router-контекстом даже там, где сам экран это не проверяет.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children?: ReactNode
    className?: string
    to?: string
  }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}))

import { reviewApi } from '@/api/review'
import { QuizSession } from './QuizSession'
import { ReviewNavigationContext } from './reviewNavigation'
const practice = vi.fn()

const ITEM = {
  review_item_id: 'R1',
  item_kind: 'token' as const,
  item_id: 'I1',
  text: 'cada',
  confidence: 1,
  translation: 'каждый',
  translation_language_code: 'ru',
  notes: null,
  context_sentence: null,
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
  model: 'm',
  latency_ms: 5,
}

function renderQuiz(kind: 'cloze' | 'reverse' = 'cloze') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReviewNavigationContext.Provider value={{ choose: vi.fn(), practice }}>
        <QuizSession lang="pt" kind={kind} />
      </ReviewNavigationContext.Provider>
    </QueryClientProvider>,
  )
}

describe('QuizSession (cloze)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(CLOZE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
  })

  it('correct option shows feedback then grade bar posts quality', async () => {
    renderQuiz()
    expect(await screen.findByText('___ dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'cloze', review_item_id: 'R1' })
    // до выбора GradeBar нет
    expect(screen.queryByRole('button', { name: /5.*Вспомнил сразу/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cada' }))
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /5.*Вспомнил сразу/ }))
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

describe('QuizSession (reverse)', () => {
  const REVERSE = {
    payload: {
      sentence: 'Cada dia é único.',
      options: [
        { text: 'каждый', is_correct: true },
        { text: 'весь', is_correct: false },
        { text: 'любой', is_correct: false },
        { text: 'никакой', is_correct: false },
      ],
    },
    model: 'm',
    latency_ms: 5,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(REVERSE)
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 2,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
  })

  it('renders word and sentence, correct option shows feedback then grade bar posts quality', async () => {
    renderQuiz('reverse')
    expect(await screen.findByText('Cada dia é único.')).toBeTruthy()
    expect(reviewApi.exercise).toHaveBeenCalledWith({ kind: 'reverse', review_item_id: 'R1' })
    expect(screen.getByText('cada')).toBeTruthy()
    expect(screen.queryByText('___ dia é único.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'каждый' }))
    expect(await screen.findByText('✅ Верно!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /4.*/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 4))
  })
})

describe('QuizSession final screen — writing exercise', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reviewApi.queue).mockResolvedValue({ items: [ITEM], daily: DAILY })
    vi.mocked(reviewApi.exercise).mockResolvedValue(CLOZE)
  })

  it('opens the interactive practice for the exact difficult selection without generating static text', async () => {
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 1,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
    renderQuiz()
    fireEvent.click(await screen.findByRole('button', { name: 'Cada' }))
    fireEvent.click(screen.getByRole('button', { name: /^3/ }))
    await screen.findByText('Сессия завершена')
    expect(screen.queryByRole('button', { name: /Повторить ошибки/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Закрепить трудные слова/ }))
    expect(practice).toHaveBeenCalledWith(['R1'])
    expect(reviewApi.exercise).toHaveBeenCalledTimes(1)
  })

  it('holding an option key does not grade the answer', async () => {
    renderQuiz()
    await screen.findByRole('button', { name: 'Cada' })
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: '2', repeat: true })
    expect(reviewApi.answer).not.toHaveBeenCalled()
    fireEvent.keyUp(window, { key: '2' })
    fireEvent.keyDown(window, { key: '4' })
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 4))
  })

  it('hides writing exercise button when all answers are correct (quality >= 4)', async () => {
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 3,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
    renderQuiz()
    fireEvent.click(await screen.findByRole('button', { name: 'Cada' }))
    fireEvent.click(screen.getByRole('button', { name: /^5/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 5))
    expect(await screen.findByText('Сессия завершена')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Закрепить трудные слова/ })).toBeNull()
  })

  it('в скоупе урока доступны только фактические ошибки', async () => {
    vi.mocked(reviewApi.answer).mockResolvedValue({
      new_confidence: 1,
      new_status: 'tracked',
      due_at: '2026-07-21T12:00:00Z',
      done_today: 1,
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <QuizSession lang="pt" kind="cloze" lessonId="L1" />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cada' }))
    fireEvent.click(screen.getByRole('button', { name: /^2/ }))
    await waitFor(() => expect(reviewApi.answer).toHaveBeenCalledWith('R1', 2))
    expect(await screen.findByRole('button', { name: /Повторить ошибки/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Пройти ещё раз' })).toBeNull()
  })
})
