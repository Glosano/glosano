import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

describe('bulk-known flow, undo, hotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReaderStore.setState({
      mode: 'page',
      pageIndex: 0,
      sentenceFlatIndex: 0,
      vocabularyPanelPinned: false,
      lastBulkActionId: null,
      font: { size: 1, lineHeight: 1, serif: false },
    })
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(readerApi.putPosition).mockResolvedValue(undefined)
    vi.mocked(vocabularyApi.phrases).mockResolvedValue([])
    vi.mocked(readerApi.vocabulary).mockResolvedValue({
      lesson_id: 'lesson-1',
      language_code: 'en',
      items: [],
    })
  })

  it('refreshes the real New tab after page bulk-known and undo', async () => {
    let bulked = false
    const snapshotItem = (text: string, ordinal: number) => ({
      kind: 'token' as const,
      item_id: bulked && text === 'w0' ? 'known-w0' : null,
      text,
      display_text: text,
      status: bulked && text === 'w0' ? ('known' as const) : ('new' as const),
      confidence: null,
      primary_translation: null,
      added_here: false,
      context: {
        segment_id: ordinal < 250 ? 'seg-1' : 'seg-2',
        token_ordinal: ordinal,
        sentence_text: text,
      },
    })
    vi.mocked(readerApi.vocabulary).mockImplementation(async () => ({
      lesson_id: 'lesson-1',
      language_code: 'en',
      items: [snapshotItem('w0', 0), snapshotItem('w250', 250)],
    }))
    vi.mocked(readerApi.bulkKnown).mockImplementation(async () => {
      bulked = true
      return { action_id: 'bulk-list', created_count: 1 }
    })
    vi.mocked(readerApi.undoBulk).mockImplementation(async () => {
      bulked = false
      return { undone_count: 1 }
    })

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    fireEvent.keyDown(await screen.findByRole('tab', { name: 'Новые' }), { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Открыть карточку w0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть карточку w250' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Открыть карточку w0' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Открыть карточку w250' })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }))
    expect(await screen.findByRole('button', { name: 'Открыть карточку w0' })).toBeInTheDocument()
  })

  it('advances the page via bulk-known with the exact ordinal range, then undoes via the toast', async () => {
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-1', created_count: 2 })
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 2 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))

    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toEqual({
        request_id: expect.any(String),
        lesson_id: 'lesson-1',
        source_version: 1,
        from_ordinal: 0,
        to_ordinal: 249,
      }),
    )

    const toast = await screen.findByTestId('undo-toast')
    expect(toast).toHaveTextContent('2 слова отмечены как известные')

    // Page advanced to the second page (contains the first word of sentence 2).
    await waitFor(() => expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w250'))

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))

    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.undoBulk))).toEqual('action-1'))
    await waitFor(() => expect(screen.queryByTestId('undo-toast')).not.toBeInTheDocument())
  })

  it('advances without a toast when created_count is 0', async () => {
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-2', created_count: 0 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))

    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toEqual({
        request_id: expect.any(String),
        lesson_id: 'lesson-1',
        source_version: 1,
        from_ordinal: 0,
        to_ordinal: 249,
      }),
    )

    await waitFor(() => expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w250'))
    expect(screen.queryByTestId('undo-toast')).not.toBeInTheDocument()
  })

  it('toggles view mode with "m" and marks the sentence known on ArrowRight', async () => {
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-3', created_count: 5 })

    renderPage()

    await screen.findByTestId('page-view-slot')

    fireEvent.keyDown(window, { key: 'm' })
    await screen.findByTestId('sentence-view-slot')
    expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w0')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toEqual({
        request_id: expect.any(String),
        lesson_id: 'lesson-1',
        source_version: 1,
        from_ordinal: 0,
        to_ordinal: 249,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w250'))
  })

  it('advances the sentence via bulk-known with the exact ordinal range, then undoes via the toast', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-1',
        current_token_ordinal: 0,
      },
    })
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-s1', created_count: 250 })
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 250 })

    renderPage()

    await screen.findByTestId('sentence-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующее предложение' }))

    await waitFor(() =>
      expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toEqual({
        request_id: expect.any(String),
        lesson_id: 'lesson-1',
        source_version: 1,
        from_ordinal: 0,
        to_ordinal: 249,
      }),
    )

    const toast = await screen.findByTestId('undo-toast')
    expect(toast).toHaveTextContent('250 слов отмечены как известные')
    await waitFor(() => expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w250'))

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))

    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.undoBulk))).toEqual('action-s1'))
    await waitFor(() => expect(screen.queryByTestId('undo-toast')).not.toBeInTheDocument())
  })

  it('does not advance the sentence and shows an error when bulk-known fails', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-1',
        current_token_ordinal: 0,
      },
    })
    vi.mocked(readerApi.bulkKnown).mockRejectedValue(new Error('network error'))

    renderPage()

    await screen.findByTestId('sentence-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующее предложение' }))

    await screen.findByTestId('bulk-error')
    expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w0')
    expect(screen.getByTestId('sentence-view-slot')).not.toHaveTextContent('w250')
  })

  it('advances past a punctuation-only sentence without calling bulk-known', async () => {
    const punctuationSentence: Sentence = {
      seg_id: 'seg-punct',
      index: 0,
      text: '…',
      normalized_text: '…',
      tokens: [{ p: '…' }],
    }
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-punct',
        current_token_ordinal: 0,
      },
    })
    vi.mocked(readerApi.content).mockResolvedValue({
      ...content,
      paragraphs: [{ sentences: [punctuationSentence, sentence1] }],
    })

    renderPage()

    await screen.findByTestId('sentence-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующее предложение' }))

    await waitFor(() => expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w0'))
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it('undoes the last bulk action with Ctrl+Z', async () => {
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-9', created_count: 3 })
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 3 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))

    await screen.findByTestId('undo-toast')

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(firstCallArg(vi.mocked(readerApi.undoBulk))).toEqual('action-9'))
    await waitFor(() => expect(screen.queryByTestId('undo-toast')).not.toBeInTheDocument())
  })

  // jsdom viewport is 1024px wide, so the swipe threshold is 0.18 * 1024 ≈ 184px.
  describe('touch swipes', () => {
    function touch(x: number, y: number) {
      return { clientX: x, clientY: y }
    }
    function swipe(target: Element, points: Array<[number, number]>, fingers = 1) {
      const [first, ...rest] = points
      const last = points.at(-1)!
      fireEvent.touchStart(target, {
        touches: Array.from({ length: fingers }, () => touch(...first!)),
        changedTouches: [touch(...first!)],
      })
      for (const point of rest) {
        fireEvent.touchMove(target, {
          touches: Array.from({ length: fingers }, () => touch(...point)),
          changedTouches: [touch(...point)],
        })
      }
      fireEvent.touchEnd(target, { touches: [], changedTouches: [touch(...last)] })
    }

    it('turns the page on a left swipe that starts on a word', async () => {
      vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-1', created_count: 2 })
      renderPage()
      const slot = await screen.findByTestId('page-view-slot')
      swipe(within(slot).getByText('w5'), [[600, 300], [580, 302], [300, 310]])
      await waitFor(() =>
        expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toMatchObject({
          from_ordinal: 0,
          to_ordinal: 249,
        }),
      )
      await waitFor(() => expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w250'))
    })

    it('does not turn the page on a vertical scroll that drifts sideways', async () => {
      renderPage()
      const slot = await screen.findByTestId('page-view-slot')
      swipe(within(slot).getByText('w5'), [[600, 300], [600, 320], [300, 340]])
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(readerApi.bulkKnown).not.toHaveBeenCalled()
      expect(slot).toHaveTextContent('w0')
    })

    it('does not turn the page on a two-finger gesture', async () => {
      renderPage()
      const slot = await screen.findByTestId('page-view-slot')
      swipe(within(slot).getByText('w5'), [[600, 300], [580, 300], [300, 300]], 2)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(readerApi.bulkKnown).not.toHaveBeenCalled()
    })

    // FLQ-32.2: a long-press drag selects a phrase; its sideways travel must not
    // be read as a page-turn swipe.
    it('selects a phrase by long-press drag without turning the page', async () => {
      renderPage()
      const slot = await screen.findByTestId('page-view-slot')
      const original = document.elementFromPoint
      document.elementFromPoint = ((px: number) =>
        slot.querySelector(`[data-ordinal="${Math.floor(px / 10)}"]`)) as typeof document.elementFromPoint
      try {
        const start = within(slot).getByText('w5')
        fireEvent.touchStart(start, { touches: [touch(55, 300)], changedTouches: [touch(55, 300)] })
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 450))
        })
        fireEvent.touchMove(start, { touches: [touch(75, 300)], changedTouches: [touch(75, 300)] })
        fireEvent.touchMove(start, { touches: [touch(500, 300)], changedTouches: [touch(500, 300)] })
        fireEvent.touchEnd(start, { touches: [], changedTouches: [touch(500, 300)] })
        const card = await screen.findByTestId('word-card')
        expect(card).toHaveTextContent('w5 w6 w7 w8 w9 w10 w11 w12')
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(readerApi.bulkKnown).not.toHaveBeenCalled()
        expect(slot).toHaveTextContent('w0')
      } finally {
        document.elementFromPoint = original
      }
    })

    it('opens the end page on the last page and swipes back to the text', async () => {
      vi.mocked(lessonsApi.get).mockResolvedValue({
        ...baseLesson,
        reader_position: {
          view_mode: 'page',
          current_segment_id: 'seg-2',
          current_token_ordinal: 259,
        },
      })
      renderPage()
      const slot = await screen.findByTestId('page-view-slot')
      await waitFor(() => expect(slot).toHaveTextContent('w250'))
      swipe(within(slot).getByText('w251'), [[600, 300], [580, 300], [300, 300]])
      const heading = await screen.findByRole('heading', { name: 'Вы всё прочитали' })
      swipe(heading, [[300, 300], [320, 300], [600, 300]])
      expect(await screen.findByTestId('page-view-slot')).toHaveTextContent('w250')
      expect(readerApi.bulkKnown).not.toHaveBeenCalled()
      expect(readerApi.complete).not.toHaveBeenCalled()
    })
  })

  // http://<lan-ip> is not a secure context: crypto.randomUUID is undefined
  // there, while getRandomValues still works.
  describe('in a non-secure context', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('advances the page via bulk-known without crypto.randomUUID', async () => {
      vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-1', created_count: 2 })

      renderPage()
      await screen.findByTestId('page-view-slot')
      const real = globalThis.crypto
      vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
      fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }))

      await waitFor(() =>
        expect(firstCallArg(vi.mocked(readerApi.bulkKnown))).toMatchObject({
          request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          from_ordinal: 0,
          to_ordinal: 249,
        }),
      )
      await waitFor(() => expect(screen.getByTestId('page-view-slot')).toHaveTextContent('w250'))
    })

    it('stays navigable when the bulk-known request cannot be prepared', async () => {
      vi.mocked(readerApi.content).mockResolvedValue({
        ...content,
        paragraphs: [{ sentences: [sentence1, sentence2, makeSentence('seg-3', 2, 260, 5)] }],
      })
      vi.mocked(lessonsApi.get).mockResolvedValue({
        ...baseLesson,
        reader_position: {
          view_mode: 'sentence',
          current_segment_id: 'seg-2',
          current_token_ordinal: 250,
        },
      })

      renderPage()
      await waitFor(() => expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w250'))
      vi.stubGlobal('crypto', {
        getRandomValues: () => {
          throw new Error('no entropy source')
        },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Следующее предложение' }))

      await screen.findByTestId('bulk-error')
      expect(readerApi.bulkKnown).not.toHaveBeenCalled()
      expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w250')

      fireEvent.click(screen.getByRole('button', { name: 'Предыдущее предложение' }))
      await waitFor(() => expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('w0'))
    })
  })
})
