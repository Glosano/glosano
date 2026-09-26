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

const finishBody = {
  lesson_id: 'lesson-1',
  source_version: 1,
  view_mode: 'page',
  last_segment_id: 'seg-2',
  from_ordinal: 250,
  to_ordinal: 259,
}

async function openEndPage() {
  fireEvent.click(await screen.findByRole('button', { name: 'Следующая страница' }))
  return screen.findByRole('heading', { name: 'Вы всё прочитали' })
}

describe('end-of-material page (ADR-0023)', () => {
  it('opens from the last page without writing and returns without side effects', async () => {
    renderPage()
    await openEndPage()
    expect(screen.queryByTestId('page-view-slot')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readerApi.complete).not.toHaveBeenCalled()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
    expect(useReaderStore.getState().pageIndex).toBe(1)
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к тексту' }))
    expect(await screen.findByTestId('page-view-slot')).toHaveTextContent('w250')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(await screen.findByRole('heading', { name: 'Вы всё прочитали' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(await screen.findByTestId('page-view-slot')).toHaveTextContent('w250')
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая страница' }))
    await waitFor(() => expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w0'))
    expect(readerApi.complete).not.toHaveBeenCalled()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it('opens once on a double press and never writes', async () => {
    renderPage()
    const next = await screen.findByRole('button', { name: 'Следующая страница' })
    fireEvent.click(next)
    fireEvent.click(next)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(await screen.findAllByRole('heading', { name: 'Вы всё прочитали' })).toHaveLength(1)
    expect(readerApi.complete).not.toHaveBeenCalled()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it('finishes from the end page and restores the last page after undo', async () => {
    renderPage()
    await openEndPage()
    expect(screen.getByText('Новые слова последней страницы будут отмечены как известные')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Вы всё прочитали' })).toHaveFocus(),
    )
    const finish = screen.getByRole('button', { name: 'Завершить материал' })
    fireEvent.click(finish)
    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual(finishBody))
    expect(await screen.findByTestId('completion-screen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить чтение' }))
    expect(screen.queryByTestId('completion-screen')).not.toBeInTheDocument()
    expect(screen.queryByTestId('end-of-material')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Итоги чтения' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отменить завершение' }))
    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.undoBulk))).toBe('completion-1'))
    await waitFor(() => expect(screen.queryByTestId('completion-screen')).not.toBeInTheDocument())
    expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w250')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Следующая страница' })).toHaveFocus(),
    )
  })

  it('keeps the end page and allows retry after a failure', async () => {
    vi.mocked(readerApi.complete).mockRejectedValueOnce(new Error('network'))
    renderPage()
    await openEndPage()
    fireEvent.click(screen.getByRole('button', { name: 'Завершить материал' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось завершить материал')
    expect(screen.getByTestId('end-of-material')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Завершить материал' }))
    expect(await screen.findByTestId('completion-screen')).toBeInTheDocument()
    expect(readerApi.complete).toHaveBeenCalledTimes(2)
  })

  it('leaves the end page when the view mode is toggled', async () => {
    renderPage()
    await openEndPage()
    fireEvent.keyDown(window, { key: 'm' })
    expect(await screen.findByTestId('sentence-view-slot')).toBeInTheDocument()
    expect(screen.queryByTestId('end-of-material')).not.toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Следующее предложение' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить материал' }))
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual({
        ...finishBody,
        view_mode: 'sentence',
      }),
    )
  })

  it('completes an empty material without the new-words note', async () => {
    vi.mocked(readerApi.content).mockResolvedValue({ ...content, word_count: 0, paragraphs: [] })
    vi.mocked(readerApi.complete).mockResolvedValue({
      action_id: 'empty',
      created_count: 0,
      completed_at: '2026-09-13T00:00:00Z',
    })
    renderPage()
    await openEndPage()
    expect(screen.queryByText(/будут отмечены как известные/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Завершить материал' }))
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.complete))).toEqual({
        ...finishBody,
        last_segment_id: null,
        from_ordinal: null,
        to_ordinal: null,
      }),
    )
    expect(await screen.findByRole('button', { name: 'Отменить завершение' })).toBeInTheDocument()
  })
})

describe('completed material', () => {
  beforeEach(() => {
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
  })

  it('loads completed state on reopening, including undo', async () => {
    renderPage()
    expect(await screen.findByText('Материал завершён')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить завершение' }))
    await waitFor(() =>
      expect(vi.mocked(readerApi.undoBulk).mock.calls.at(-1)?.[0]).toBe('restored-completion'),
    )
  })

  it('shows the completed end page with library and review actions', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить чтение' }))
    expect(screen.getByRole('button', { name: 'Итоги чтения' })).toBeInTheDocument()
    await openEndPageCompleted()
    // The completed banner is hidden on the end page, so results cannot be opened
    // from there and later return the reader to the end page instead of the text.
    expect(screen.queryByRole('button', { name: 'Итоги чтения' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Материал завершён')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Завершить материал' })).not.toBeInTheDocument()
    expect(screen.getByText('Повторить лексику урока')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к тексту' }))
    expect(await screen.findByTestId('page-view-slot')).toHaveTextContent('w250')
    expect(screen.getByRole('button', { name: 'Итоги чтения' })).toBeInTheDocument()
    expect(readerApi.complete).not.toHaveBeenCalled()
  })
})

async function openEndPageCompleted() {
  fireEvent.click(await screen.findByRole('button', { name: 'Следующая страница' }))
  return screen.findByRole('heading', { name: 'Материал завершён' })
}
