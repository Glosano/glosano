import userEvent from '@testing-library/user-event'
import { setUiLanguage } from '@/lib/i18n'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LessonDetail } from '@/api/lessons'
import type { LessonContent, Sentence, Token } from '@/api/reader'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}))

vi.mock('@/api/lessons', () => ({
  lessonsApi: {
    get: vi.fn(),
  },
}))

vi.mock('@/api/reader', () => ({
  isWord: (tok: { t?: string }) => 't' in tok,
  readerApi: {
    content: vi.fn(),
    statuses: vi.fn(),
    putPosition: vi.fn(),
    bulkKnown: vi.fn(),
    complete: vi.fn(),
    completionSummary: vi.fn(),
    undoBulk: vi.fn(),
    segmentTranslation: vi.fn(),
    vocabulary: vi.fn(),
  },
}))

vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: {
    lookup: vi.fn(),
    createItem: vi.fn(),
    patchItem: vi.fn(),
    addTranslation: vi.fn(),
    updateTranslation: vi.fn(),
    deleteTranslation: vi.fn(),
    putNote: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    phrases: vi.fn(),
  },
}))

import { lessonsApi } from '@/api/lessons'
import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'

import { useReaderStore } from './readerStore'
import { ReaderPage } from './ReaderPage'

/** Builds `count` word tokens with globally increasing ordinals starting at `startOrdinal`. */
function makeWordTokens(startOrdinal: number, count: number): Token[] {
  const tokens: Token[] = []
  for (let idx = 0; idx < count; idx += 1) {
    if (idx > 0) tokens.push({ ws: ' ' })
    const ordinal = startOrdinal + idx
    tokens.push({ t: `w${ordinal}`, n: `w${ordinal}`, i: ordinal })
  }
  return tokens
}

function makeSentence(
  segId: string,
  index: number,
  startOrdinal: number,
  wordCount: number,
): Sentence {
  const tokens = makeWordTokens(startOrdinal, wordCount)
  return {
    seg_id: segId,
    index,
    text: tokens
      .filter((t): t is Extract<Token, { t: string }> => 't' in t)
      .map((t) => t.t)
      .join(' '),
    normalized_text: '',
    tokens: [...tokens, { p: '.' }],
  }
}

const baseLesson: LessonDetail = {
  id: 'lesson-1',
  title: 'Test Lesson',
  language_code: 'en',
  word_count: 260,
  visibility: 'private',
  status: 'ready',
  created_at: '2026-01-01T00:00:00Z',
  segment_count: 2,
  reader_position: null,
  read_percent: 0,
  new_words_remaining: 260,
}

// Sentence 1 has exactly 250 words -> flushes as its own page (fromOrdinal 0,
// toOrdinal 249). Sentence 2 has 10 trailing words -> a second, final page
// (fromOrdinal 250, toOrdinal 259).
const sentence1 = makeSentence('seg-1', 0, 0, 250)
const sentence2 = makeSentence('seg-2', 1, 250, 10)

const content: LessonContent = {
  lesson_id: 'lesson-1',
  source_version: 1,
  language_code: 'en',
  word_count: 260,
  paragraphs: [{ sentences: [sentence1, sentence2] }],
}

/**
 * TanStack Query v5 calls `mutationFn(variables, context)` — a second,
 * internal context argument is always present, so we assert on the first
 * call's first argument rather than the full call signature.
 */
function firstCallArg(mockFn: { mock: { calls: unknown[][] } }): unknown {
  return mockFn.mock.calls[0]?.[0]
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReaderPage lang="en" lessonId="lesson-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => setUiLanguage('ru'))
beforeEach(() => {
  vi.resetAllMocks()
  setUiLanguage('ru')
  vi.mocked(vocabularyApi.lookup).mockResolvedValue({
    item_id: null,
    status: 'new',
    confidence: null,
    translations: { primary: null, all: [] },
    note: null,
    tags: [],
  })
  useReaderStore.setState({
    mode: 'page',
    pageIndex: 0,
    sentenceFlatIndex: 0,
    vocabularyPanelPinned: false,
    lastBulkActionId: null,
    font: { size: 1, lineHeight: 1, serif: false },
  })
  vi.mocked(lessonsApi.get).mockResolvedValue({
    ...baseLesson,
    reader_position: {
      view_mode: 'page',
      current_segment_id: 'seg-2',
      current_token_ordinal: 259,
    },
  })
  vi.mocked(readerApi.content).mockResolvedValue(content)
  vi.mocked(readerApi.statuses).mockResolvedValue({})
  vi.mocked(readerApi.putPosition).mockResolvedValue(undefined)
  vi.mocked(vocabularyApi.phrases).mockResolvedValue([])
  vi.mocked(readerApi.vocabulary).mockResolvedValue({
    lesson_id: 'lesson-1',
    language_code: 'en',
    items: [],
  })
  vi.mocked(readerApi.complete).mockResolvedValue({
    action_id: 'completion-1',
    created_count: 10,
    completed_at: '2026-09-13T00:00:00Z',
  })
  vi.mocked(readerApi.completionSummary).mockResolvedValue({
    action_id: 'restored-completion',
    completed_at: '2026-09-13T00:00:00Z',
    created_count: 10,
    summary: null,
  })
  vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 10 })
})

describe('lesson completion', () => {
  it('replaces the final arrow, confirms before writing, and keeps undo available', async () => {
    renderPage()
    const finish = await screen.findByRole('button', { name: 'Завершить материал' })
    expect(screen.queryByRole('button', { name: 'Следующая страница' })).not.toBeInTheDocument()
    fireEvent.click(finish)
    expect(await screen.findByRole('dialog', { name: 'Завершить материал?' })).toBeInTheDocument()
    expect(readerApi.complete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }))
    expect(readerApi.complete).not.toHaveBeenCalled()
    fireEvent.click(finish)
    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual({
        lesson_id: 'lesson-1',
        source_version: 1,
        view_mode: 'page',
        last_segment_id: 'seg-2',
        from_ordinal: 250,
        to_ordinal: 259,
      }),
    )
    expect(await screen.findByText('Материал завершён')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить чтение' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить чтение' }))
    expect(screen.queryByTestId('completion-screen')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Итоги чтения' }))
    expect(screen.getByTestId('completion-screen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить завершение' }))
    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.undoBulk))).toBe('completion-1'))
    await waitFor(() => expect(screen.queryByText('Материал завершён')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Завершить материал' })).toHaveFocus(),
    )
  })

  it('allows retry after a failure and suppresses navigation while confirming', async () => {
    vi.mocked(readerApi.complete).mockRejectedValueOnce(new Error('network'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить материал' }))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'm' })
    expect(useReaderStore.getState().pageIndex).toBe(1)
    expect(useReaderStore.getState().mode).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось завершить материал')
    expect(screen.queryByText('Материал завершён')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    expect(await screen.findByText('Материал завершён')).toBeInTheDocument()
    expect(readerApi.complete).toHaveBeenCalledTimes(2)
  })

  it('completes the final sentence with its own range', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-2',
        current_token_ordinal: 259,
      },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить материал' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual({
        lesson_id: 'lesson-1',
        source_version: 1,
        view_mode: 'sentence',
        last_segment_id: 'seg-2',
        from_ordinal: 250,
        to_ordinal: 259,
      }),
    )
  })

  it('completes an empty material and offers undo even when no words were added', async () => {
    vi.mocked(readerApi.content).mockResolvedValue({ ...content, word_count: 0, paragraphs: [] })
    vi.mocked(readerApi.complete).mockResolvedValue({
      action_id: 'empty',
      created_count: 0,
      completed_at: '2026-09-13T00:00:00Z',
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить материал' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual({
        lesson_id: 'lesson-1',
        source_version: 1,
        view_mode: 'page',
        last_segment_id: null,
        from_ordinal: null,
        to_ordinal: null,
      }),
    )
    expect(await screen.findByText('Материал завершён')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отменить завершение' })).toBeInTheDocument()
  })
})

describe('completion keyboard and persistence', () => {
  it('returns focus on cancel and to the completion status after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, reader_position: null })
    vi.mocked(readerApi.content).mockResolvedValue({
      ...content,
      paragraphs: [{ sentences: [sentence2] }],
    })
    renderPage()
    const finish = await screen.findByRole('button', { name: 'Завершить материал' })
    await user.click(finish)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(finish).toHaveFocus())
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: 'Да' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
  })

  it('loads completed state on reopening, including undo and 100 percent', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'page',
        current_segment_id: 'seg-2',
        current_token_ordinal: 259,
        completed_at: '2026-09-13T00:00:00Z',
        completion_action_id: 'restored-completion',
      },
    })
    renderPage()
    expect(await screen.findByText('Материал завершён')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить завершение' }))
    await waitFor(() =>
      expect(vi.mocked(readerApi.undoBulk).mock.calls.at(-1)?.[0]).toBe('restored-completion'),
    )
  })
})
