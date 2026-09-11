import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/review', () => ({
  reviewApi: {
    counts: vi.fn(),
    queue: vi.fn(),
    exercise: vi.fn(),
    exerciseFeedback: vi.fn(),
    answer: vi.fn(),
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

import { reviewApi } from '@/api/review'
import { getUiLanguage, setUiLanguage } from '@/lib/i18n'
import { ModeSelect } from './ModeSelect'
import { NewWordsSession } from './NewWordsSession'
import { QuizSession } from './QuizSession'
import { TranslationSession } from './TranslationSession'
import { SessionSummary } from './sessionUi'

const item = {
  review_item_id: 'R1',
  item_kind: 'token' as const,
  item_id: 'I1',
  text: 'cada',
  confidence: 1,
  translation: 'мой личный перевод',
  notes: null,
  context_sentence: null,
}
const daily = { limit: 20, done_today: 0, limit_reached: false }
const example = (english: boolean) => ({
  payload: {
    sentence: 'Cada dia é único.',
    sentence_translation: english ? 'Every day is unique.' : 'Каждый день уникален.',
    base_form: 'cada',
    base_form_translation: english ? 'each' : 'каждый',
  },
  model: 'm',
  latency_ms: 5,
})

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  setUiLanguage('en')
  vi.mocked(reviewApi.queue).mockResolvedValue({ items: [item], daily })
})
afterEach(() => {
  act(() => setUiLanguage('ru'))
})

describe('Review localization', () => {
  it('switches all mode titles and AI-disabled hints live', async () => {
    vi.mocked(reviewApi.counts).mockResolvedValue({
      due: 1,
      new: 1,
      practice: 1,
      ai_enabled: false,
    })
    show(<ModeSelect lang="pt" />)
    expect(await screen.findByText('Flashcards')).toBeInTheDocument()
    expect(screen.getByText('Classic flip cards')).toBeInTheDocument()
    expect(screen.getAllByText('AI is disabled')).toHaveLength(4)
    act(() => setUiLanguage('ru'))
    expect(screen.getByText('Карточки')).toBeInTheDocument()
    expect(screen.getAllByText('AI отключён')).toHaveLength(4)
  })

  it('replaces a pending old-locale example without translating the studied word or saved text', async () => {
    setUiLanguage('ru')
    let finishOld!: (value: ReturnType<typeof example>) => void
    vi.mocked(reviewApi.exercise).mockImplementation(() =>
      getUiLanguage() === 'ru'
        ? new Promise((resolve) => {
            finishOld = resolve
          })
        : Promise.resolve(example(true)),
    )
    show(<NewWordsSession lang="pt" />)
    await waitFor(() => expect(reviewApi.exercise).toHaveBeenCalledTimes(1))
    act(() => setUiLanguage('en'))
    expect(await screen.findByText('Cada dia é único.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show translation' }))
    expect(screen.getByText('Every day is unique.')).toBeInTheDocument()
    expect(screen.getByText('мой личный перевод')).toBeInTheDocument()
    await act(async () => {
      finishOld(example(false))
    })
    expect(screen.queryByText('Каждый день уникален.')).not.toBeInTheDocument()
    expect(screen.getByText('Every day is unique.')).toBeInTheDocument()
  })

  it('resets quiz choices and feedback when the interface language changes', async () => {
    vi.mocked(reviewApi.exercise).mockResolvedValue({
      payload: {
        sentence_with_gap: '___ dia é único.',
        sentence_translation: 'Every day is unique.',
        options: [
          { text: 'Cada', is_correct: true },
          { text: 'Todo', is_correct: false },
        ],
      },
      model: 'm',
      latency_ms: 1,
    })
    show(<QuizSession lang="pt" kind="cloze" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Todo' }))
    expect(screen.getByText('❌ Correct answer: Cada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5 — Perfect' })).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(await screen.findByRole('button', { name: 'Todo' })).toBeEnabled()
    expect(screen.queryByText('❌ Correct answer: Cada')).not.toBeInTheDocument()
    expect(screen.getByText('Квиз: пропуск')).toBeInTheDocument()
    expect(screen.getByText('___ dia é único.')).toBeInTheDocument()
  })

  it('keeps translation direction explicit and discards late feedback from the old locale', async () => {
    vi.mocked(reviewApi.exercise).mockImplementation(() =>
      Promise.resolve({
        payload: {
          sentence_translation:
            getUiLanguage() === 'en' ? 'Every day is unique.' : 'Каждый день уникален.',
        },
        model: 'm',
        latency_ms: 1,
      }),
    )
    let finishFeedback!: (result: { feedback: string }) => void
    vi.mocked(reviewApi.exerciseFeedback).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishFeedback = resolve
        }),
    )
    show(<TranslationSession lang="pt" />)
    expect(await screen.findByText('Every day is unique.')).toBeInTheDocument()
    expect(screen.getByText('Translate the sentence into Portuguese.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your translation' }), {
      target: { value: 'Cada dia é único.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    await waitFor(() => expect(reviewApi.exerciseFeedback).toHaveBeenCalledTimes(1))
    act(() => setUiLanguage('ru'))
    expect(await screen.findByText('Каждый день уникален.')).toBeInTheDocument()
    expect(screen.getByText('Переведите предложение на португальский.')).toBeInTheDocument()
    await act(async () => {
      finishFeedback({ feedback: 'Old English feedback' })
    })
    expect(screen.queryByText('Old English feedback')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Ваш перевод' })).toHaveValue('')
    expect(reviewApi.answer).not.toHaveBeenCalled()
  })

  it('discards a generated writing instruction on a live locale switch', async () => {
    vi.mocked(reviewApi.exercise).mockResolvedValue({
      payload: { text: 'Write a sentence using cada.' },
      model: 'm',
      latency_ms: 1,
    })
    show(
      <SessionSummary
        results={[{ item, quality: 2 }]}
        restart={() => {}}
        graduated={false}
        dismissGraduation={() => {}}
        showWriting
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Writing exercise for your mistakes' }))
    expect(await screen.findByText('Write a sentence using cada.')).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.queryByText('Write a sentence using cada.')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Письменное упражнение по ошибкам' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Средняя оценка: 2,0')).toBeInTheDocument()
  })
})
