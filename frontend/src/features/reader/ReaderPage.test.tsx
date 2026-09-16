if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string
    constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LessonDetail } from '@/api/lessons'
import type { LessonContent, StatusMap } from '@/api/reader'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))
const video = vi.hoisted(() => ({ time: 1, state: 2 }))
vi.mock('./video/youtubePlayer', () => ({
  createYouTubePlayer: async (
    _host: HTMLElement,
    _id: string,
    events: { onState: (state: number) => void },
  ) => ({
    play: () => {
      video.state = 1
      events.onState(1)
    },
    pause: () => {
      video.state = 2
      events.onState(2)
    },
    seek: (time: number) => {
      video.time = time
    },
    time: () => video.time,
    rate: () => 1,
    destroy: () => {
      video.state = 2
    },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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
vi.mock('@/api/dictionary', () => ({ dictionaryApi: { lookup: vi.fn() } }))
vi.mock('@/api/ai', () => ({ aiApi: { translate: vi.fn() } }))

import { lessonsApi } from '@/api/lessons'
import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'
import { dictionaryApi } from '@/api/dictionary'
import { aiApi } from '@/api/ai'
import { ApiError } from '@/api/client'

import { useReaderStore } from './readerStore'
import { ReaderPage } from './ReaderPage'
import { setUiLanguage } from '@/lib/i18n'

afterEach(() => {
  vi.useRealTimers()
  setUiLanguage('ru')
})

const baseLesson: LessonDetail = {
  id: 'lesson-1',
  title: 'Test Lesson',
  language_code: 'en',
  word_count: 4,
  visibility: 'private',
  status: 'ready',
  created_at: '2026-01-01T00:00:00Z',
  segment_count: 1,
  reader_position: null,
  read_percent: 0,
  new_words_remaining: 4,
}

const content: LessonContent = {
  lesson_id: 'lesson-1',
  source_version: 1,
  language_code: 'en',
  word_count: 4,
  paragraphs: [
    {
      sentences: [
        {
          seg_id: 'seg-1',
          index: 0,
          text: 'Hello world.',
          normalized_text: 'hello world.',
          tokens: [
            { t: 'Hello', n: 'hello', i: 0 },
            { ws: ' ' },
            { t: 'world', n: 'world', i: 1 },
            { p: '.' },
          ],
        },
        {
          seg_id: 'seg-2',
          index: 1,
          text: 'Goodbye now.',
          normalized_text: 'goodbye now.',
          tokens: [
            { t: 'Goodbye', n: 'goodbye', i: 2 },
            { ws: ' ' },
            { t: 'now', n: 'now', i: 3 },
            { p: '.' },
          ],
        },
      ],
    },
  ],
}

function renderPage(
  lessonId = 'lesson-1',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ReaderPage lang="en" lessonId={lessonId} />
    </QueryClientProvider>,
  )
}

function videoLesson(wordsPerFragment = 250) {
  video.time = 1
  video.state = 2
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
  vi.mocked(readerApi.statuses).mockResolvedValue({})
  vi.mocked(readerApi.bulkKnown).mockResolvedValue({
    action_id: 'video-bulk',
    created_count: 250,
    undone: false,
  })
  vi.mocked(readerApi.content).mockResolvedValue({
    ...content,
    word_count: wordsPerFragment * 2 + 1,
    media: {
      provider: 'youtube',
      video_id: 'M7lc1UVf-VE',
      canonical_url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      title: 'Video',
      author: null,
      language_code: 'en',
      is_generated: true,
    },
    paragraphs: [
      {
        sentences: [0, 1, 2].map((index) => ({
          seg_id: `video-${index}`,
          index,
          text: `Caption ${index}`,
          normalized_text: `caption ${index}`,
          media_start_ms: 1000 + index * 1000,
          media_end_ms: 2000 + index * 1000,
          tokens: Array.from({ length: index < 2 ? wordsPerFragment : 1 }, (_, ordinal) => ({
            t: `Word${index * wordsPerFragment + ordinal}`,
            n: `word${index * wordsPerFragment + ordinal}`,
            i: index * wordsPerFragment + ordinal,
          })),
        })),
      },
    ],
  })
  return renderPage()
}

async function startVideo() {
  fireEvent.click(await screen.findByRole('button', { name: 'Воспроизвести фрагмент' }))
  await screen.findByRole('button', { name: 'Пауза' })
  act(() => {
    video.time = 1.8
    vi.advanceTimersByTime(100)
  })
  act(() => {
    video.time = 1.9
    vi.advanceTimersByTime(100)
  })
}

describe('ReaderPage', () => {
  beforeEach(() => {
    setUiLanguage('ru')
    vi.clearAllMocks()
    vi.mocked(vocabularyApi.phrases).mockResolvedValue([])
    vi.mocked(readerApi.vocabulary).mockResolvedValue({
      lesson_id: 'lesson-1',
      language_code: 'en',
      items: [],
    })
    useReaderStore.setState({
      mode: 'page',
      pageIndex: 0,
      sentenceFlatIndex: 0,
      sidebarOpen: false,
      vocabularyPanelPinned: false,
      lastBulkActionId: null,
      font: { size: 1, lineHeight: 1, serif: false },
      wordCardExpanded: false,
    })
  })

  it('stops video at the current page and preserves explicit completion', async () => {
    videoLesson()
    await startVideo()
    act(() => {
      video.time = 2.02
      vi.advanceTimersByTime(100)
    })
    expect(video.state).toBe(2)
    expect(screen.getByText('Word0')).toBeVisible()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Завершить материал?' })).not.toBeInTheDocument()
  })

  it('starts playback at a clicked timestamp and can restart at another timestamp', async () => {
    videoLesson(100)
    fireEvent.click(await screen.findByRole('button', { name: 'Воспроизвести с 0:02' }))
    await screen.findByRole('button', { name: 'Пауза' })
    expect(video.time).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }))
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести с 0:03' }))
    await screen.findByRole('button', { name: 'Пауза' })
    expect(video.time).toBe(3)
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it('auto turns pages, marks the departed page and highlights the playing fragment', async () => {
    videoLesson()
    fireEvent.click(await screen.findByRole('switch', { name: 'Листать автоматически' }))
    await startVideo()
    act(() => {
      video.time = 2.02
      vi.advanceTimersByTime(100)
    })
    expect(await screen.findByText('Word250')).toBeVisible()
    await waitFor(() =>
      expect(readerApi.bulkKnown).toHaveBeenCalledWith(
        expect.objectContaining({
          lesson_id: 'lesson-1',
          from_ordinal: 0,
          to_ordinal: 249,
          request_id: expect.any(String),
        }),
        expect.anything(),
      ),
    )
    expect(video.state).toBe(1)
    expect(screen.getByText('Word250').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('follows a manual video seek without marking skipped pages known', async () => {
    videoLesson()
    fireEvent.click(await screen.findByRole('switch', { name: 'Листать автоматически' }))
    await startVideo()
    act(() => {
      video.time = 3.2
      vi.advanceTimersByTime(100)
    })
    expect(await screen.findByText('Word500')).toBeVisible()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it.each(['lesson_version_changed', 'source_version_conflict'])(
    'offers to reload when an automatic page save retry returns %s',
    async (detail) => {
      videoLesson()
      vi.mocked(readerApi.bulkKnown)
        .mockRejectedValueOnce(new Error('Response lost'))
        .mockRejectedValueOnce(new ApiError(409, detail))
      fireEvent.click(await screen.findByRole('switch', { name: 'Листать автоматически' }))
      await startVideo()
      act(() => {
        video.time = 2.02
        vi.advanceTimersByTime(100)
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Повторить сохранение' }))
      expect(await screen.findByRole('link', { name: 'Обновить страницу' })).toHaveAttribute(
        'href',
        '/learn/en/lessons/lesson-1',
      )
      expect(video.state).toBe(2)
      expect(screen.queryByRole('button', { name: 'Повторить сохранение' })).not.toBeInTheDocument()
    },
  )

  it('pauses on mode change and limits sentence mode to its fragment', async () => {
    videoLesson()
    await startVideo()
    fireEvent.click(screen.getByRole('button', { name: 'По фрагментам' }))
    expect(video.state).toBe(2)
    expect(screen.queryByRole('switch', { name: 'Листать автоматически' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Воспроизвести аудио' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести фрагмент' }))
    act(() => {
      video.time = 1.9
      vi.advanceTimersByTime(100)
    })
    act(() => {
      video.time = 2.02
      vi.advanceTimersByTime(100)
    })
    expect(video.state).toBe(2)
    expect(screen.getByTestId('sentence-view-slot')).toHaveTextContent('Word0')
  })

  it('Undo pauses playback and disables automatic paging', async () => {
    videoLesson()
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 250 })
    fireEvent.click(await screen.findByRole('switch', { name: 'Листать автоматически' }))
    await startVideo()
    act(() => {
      video.time = 2.02
      vi.advanceTimersByTime(100)
    })
    const toast = await screen.findByTestId('undo-toast')
    fireEvent.click(within(toast).getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(readerApi.undoBulk).toHaveBeenCalled())
    expect(video.state).toBe(2)
    expect(screen.getByRole('switch', { name: 'Листать автоматически' })).not.toBeChecked()
  })

  it('does not complete the material when the final video fragment ends', async () => {
    videoLesson()
    fireEvent.click(await screen.findByRole('switch', { name: 'Листать автоматически' }))
    await startVideo()
    act(() => {
      video.time = 3.7
      vi.advanceTimersByTime(100)
    })
    act(() => {
      video.time = 3.8
      vi.advanceTimersByTime(100)
    })
    act(() => {
      video.time = 3.9
      vi.advanceTimersByTime(100)
    })
    act(() => {
      video.time = 4.01
      vi.advanceTimersByTime(100)
    })
    expect(video.state).toBe(2)
    expect(screen.getByRole('button', { name: 'Завершить материал' })).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readerApi.bulkKnown).not.toHaveBeenCalled()
  })

  it('switches reader labels and all translation targets live without changing saved translations', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'saved',
      status: 'known',
      confidence: null,
      translations: {
        primary: null,
        all: [
          {
            id: 'ru-saved',
            text: 'Мой перевод',
            target_language_code: 'ru',
            is_primary: true,
            source_type: 'user',
          },
          {
            id: 'en-saved',
            text: 'My translation',
            target_language_code: 'en',
            is_primary: true,
            source_type: 'user',
          },
        ],
      },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: 'Wiktionary', license: 'CC-BY-SA 4.0', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: 'test', latency_ms: 1 })
    vi.mocked(readerApi.segmentTranslation).mockImplementation(
      async (_lesson, _segment, target) => ({
        text: target === 'en' ? 'English sentence translation' : 'Русский перевод предложения',
        source: 'ai',
        model: 'test',
        stored: true,
      }),
    )
    setUiLanguage('en')
    renderPage()
    fireEvent.click(await screen.findByText('Hello'))
    await screen.findByDisplayValue('My translation')
    expect(screen.getByRole('button', { name: 'Close card' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish material' })).toBeInTheDocument()
    await waitFor(() => expect(dictionaryApi.lookup).toHaveBeenCalledWith('en', 'en', 'hello'))
    await waitFor(() =>
      expect(aiApi.translate).toHaveBeenCalledWith(
        expect.objectContaining({ target_language_code: 'en' }),
      ),
    )

    act(() => {
      setUiLanguage('ru')
    })
    await screen.findByDisplayValue('Мой перевод')
    expect(screen.getByRole('button', { name: 'Закрыть карточку' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('My translation')).not.toBeInTheDocument()
    await waitFor(() => expect(dictionaryApi.lookup).toHaveBeenCalledWith('en', 'ru', 'hello'))
    await waitFor(() =>
      expect(aiApi.translate).toHaveBeenCalledWith(
        expect.objectContaining({ target_language_code: 'ru' }),
      ),
    )
    expect(vocabularyApi.updateTranslation).not.toHaveBeenCalled()
    expect(vocabularyApi.addTranslation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть карточку' }))
    act(() => {
      useReaderStore.setState({ mode: 'sentence' })
    })
    fireEvent.click(await screen.findByTestId('toggle-translation'))
    await screen.findByText('Русский перевод предложения')
    act(() => {
      setUiLanguage('en')
    })
    await screen.findByText('English sentence translation')
    expect(readerApi.segmentTranslation).toHaveBeenCalledWith('lesson-1', 'seg-1', 'en')
    expect(screen.getByRole('button', { name: 'Previous sentence' })).toBeInTheDocument()
    expect(screen.getAllByText('Hello').length).toBeGreaterThan(0)
  })

  it('shows processing state and does not fetch reader content', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, status: 'processing' })

    renderPage()

    expect(await screen.findByTestId('reader-processing')).toHaveTextContent('Урок готовится')
    expect(readerApi.content).not.toHaveBeenCalled()
  })

  it('shows failed state with a link back to the library', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, status: 'failed' })

    renderPage()

    expect(await screen.findByTestId('reader-failed')).toHaveTextContent(
      'Не удалось обработать урок',
    )
  })

  it('shows an unavailable state with a link back to the library for archived lessons', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, status: 'archived' })

    renderPage()

    expect(await screen.findByTestId('reader-unavailable')).toHaveTextContent('Урок недоступен')
    expect(readerApi.content).not.toHaveBeenCalled()
  })

  it('renders lesson words for a ready lesson', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    renderPage()

    const slot = await screen.findByTestId('page-view-slot')
    await waitFor(() => expect(slot).toHaveTextContent('Hello world.'))
    expect(slot).toHaveTextContent('Goodbye now.')
  })

  it('sets RTL direction only on Arabic learning content in both reader modes', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, language_code: 'ar' })
    vi.mocked(readerApi.content).mockResolvedValue({ ...content, language_code: 'ar' })
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    renderPage()

    const pageSlot = await screen.findByTestId('page-view-slot')
    expect(within(pageSlot).getByTestId('learning-content')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByTestId('reader-page')).not.toHaveAttribute('dir', 'rtl')

    act(() => useReaderStore.setState({ mode: 'sentence' }))
    const sentenceSlot = await screen.findByTestId('sentence-view-slot')
    expect(within(sentenceSlot).getByTestId('learning-content')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByTestId('reader-page')).not.toHaveAttribute('dir', 'rtl')
  })

  it('restores sentence-mode position to the segment referenced by current_segment_id', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-2',
        current_token_ordinal: 2,
      },
    })
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderPage()

    const slot = await screen.findByTestId('sentence-view-slot')
    await waitFor(() => expect(slot).toHaveTextContent('Goodbye now.'))
    expect(slot).not.toHaveTextContent('Hello world.')
  })

  it('falls back to the first sentence when current_segment_id is not found', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-missing',
        current_token_ordinal: 0,
      },
    })
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderPage()

    const slot = await screen.findByTestId('sentence-view-slot')
    await waitFor(() => expect(slot).toHaveTextContent('Hello world.'))
  })

  it('navigates sentences with the fixed edge arrows in sentence mode', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue({
      ...baseLesson,
      reader_position: {
        view_mode: 'sentence',
        current_segment_id: 'seg-1',
        current_token_ordinal: 0,
      },
    })
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-1', created_count: 2 })
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderPage()

    const slot = await screen.findByTestId('sentence-view-slot')
    await waitFor(() => expect(slot).toHaveTextContent('Hello world.'))

    const prev = screen.getByRole('button', { name: 'Предыдущее предложение' })
    const next = screen.getByRole('button', { name: 'Следующее предложение' })
    expect(prev).toBeDisabled()

    fireEvent.click(next)
    await waitFor(() => expect(slot).toHaveTextContent('Goodbye now.'))
    expect(screen.getByRole('button', { name: 'Завершить материал' })).toBeEnabled()
  })

  it('shows an error state and does not spin forever when the lesson fetch fails', async () => {
    vi.mocked(lessonsApi.get).mockRejectedValue(new Error('network error'))

    renderPage()

    expect(await screen.findByTestId('reader-error')).toHaveTextContent('Не удалось загрузить урок')
    expect(readerApi.content).not.toHaveBeenCalled()
  })

  it('resets pageIndex and disarms the undo action when the lesson changes', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = renderPage('lesson-1', queryClient)

    await screen.findByTestId('page-view-slot')

    act(() => {
      useReaderStore.setState({ pageIndex: 1, lastBulkActionId: 'stale-action' })
    })

    vi.mocked(lessonsApi.get).mockResolvedValue({ ...baseLesson, id: 'lesson-2' })

    rerender(
      <QueryClientProvider client={queryClient}>
        <ReaderPage lang="en" lessonId="lesson-2" />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(useReaderStore.getState().lastBulkActionId).toBeNull()
      expect(useReaderStore.getState().pageIndex).toBe(0)
    })
    await screen.findByTestId('page-view-slot')
  })

  it('opens the real WordCard when a word is clicked', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()

    const slot = await screen.findByTestId('page-view-slot')
    fireEvent.click(await screen.findByRole('button', { name: 'Hello' }))
    expect(await screen.findByTestId('word-card')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('Введите новый перевод здесь')).toBeInTheDocument()

    fireEvent.click(slot)
    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Словарь урока' })).not.toBeInTheDocument()
  })

  it('keeps the vocabulary panel open when returning from a pinned card to its list', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    await screen.findByTestId('page-view-slot')

    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
    await waitFor(() => {
      expect(readerApi.vocabulary).toHaveBeenCalledWith('lesson-1', 'ru')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
    expect(await screen.findByTestId('word-card')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }))
    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
  })

  it('opens a real vocabulary row in the card without changing reader position', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(readerApi.vocabulary).mockResolvedValue({
      lesson_id: 'lesson-1',
      language_code: 'en',
      items: [
        {
          kind: 'token',
          item_id: null,
          text: 'outside',
          display_text: 'Outside',
          status: 'new',
          confidence: null,
          primary_translation: null,
          added_here: false,
          context: {
            segment_id: 'seg-outside',
            token_ordinal: 0,
            sentence_text: 'Outside this page.',
          },
        },
      ],
    })
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: 'Wiktionary', license: 'CC BY-SA', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    const page = await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    fireEvent.keyDown(await screen.findByRole('tab', { name: 'Новые' }), { key: 'Enter' })
    const rowButton = await screen.findByRole('button', { name: 'Открыть карточку Outside' })
    rowButton.focus()
    fireEvent.click(rowButton)

    expect(await screen.findByTestId('word-card')).toHaveTextContent('Outside')
    expect(page).toHaveTextContent('Hello world')
    expect(useReaderStore.getState().pageIndex).toBe(0)
    expect(navigateMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }))
    expect(rowButton).toHaveFocus()
  })

  it('moves a new row into Added and updates every reader occurrence after add', async () => {
    let saved = false
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockImplementation(
      async (): Promise<StatusMap> => (saved ? { hello: { s: 'tracked', c: 1 } } : {}),
    )
    vi.mocked(readerApi.vocabulary).mockImplementation(async () => ({
      lesson_id: 'lesson-1',
      language_code: 'en',
      items: [
        {
          kind: 'token',
          item_id: saved ? 'hello-1' : null,
          text: 'hello',
          display_text: 'Hello',
          status: saved ? 'tracked' : 'new',
          confidence: saved ? 1 : null,
          primary_translation: null,
          added_here: saved,
          context: { segment_id: 'seg-1', token_ordinal: 0, sentence_text: 'Hello world.' },
        },
      ],
    }))
    vi.mocked(vocabularyApi.createItem).mockImplementation(async () => {
      saved = true
      return { item_id: 'hello-1', status: 'tracked', confidence: 1 }
    })

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    fireEvent.keyDown(await screen.findByRole('tab', { name: 'Новые' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить Hello в изучение' }))

    await screen.findByText('В этом уроке не осталось новых слов')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Добавленные' }), { key: 'Enter' })
    expect(
      await screen.findByRole('button', { name: 'Изменить уровень Hello, текущий 1' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Hello' }).className).toContain(
        '--reader-tracked-bg',
      ),
    )
    expect(vocabularyApi.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'token',
        text: 'Hello',
        lesson_id: 'lesson-1',
        segment_id: 'seg-1',
        status: 'tracked',
        confidence: 1,
      }),
    )
  })

  it('pins an open temporary card without clearing its selection', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    await screen.findByTestId('page-view-slot')

    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
    const card = await screen.findByTestId('word-card')
    expect(screen.getByRole('button', { name: 'Показать словарь урока' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const pinIconPath = screen
      .getByRole('button', { name: 'Показать словарь урока' })
      .querySelector('svg path')
    expect(pinIconPath).not.toBeNull()
    fireEvent.click(pinIconPath!)

    expect(useReaderStore.getState().vocabularyPanelPinned).toBe(true)
    expect(screen.getByTestId('word-card')).toBe(card)
    expect(screen.getByRole('button', { name: 'К списку' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }))
    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
  })

  it('closes only the temporary card on the first Escape', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
    await screen.findByTestId('word-card')
    expect(readerApi.vocabulary).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('returns a pinned card to the list on a free reader click', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    const reader = await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
    await screen.findByTestId('word-card')

    fireEvent.click(reader)

    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
  })

  it('keeps the card open when the nested expand icon is clicked', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'hello-1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))

    const expandIcon = (await screen.findByRole('button', { name: 'Развернуть' })).querySelector(
      'svg',
    )
    expect(expandIcon).not.toBeNull()
    fireEvent.click(expandIcon!)

    expect(screen.getByTestId('word-card')).toBeInTheDocument()
    expect(screen.getByTestId('word-card-expanded')).toBeInTheDocument()
  })

  it('returns a pinned card to the list from blank space below the text', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }))
    await screen.findByTestId('word-card')

    fireEvent.click(screen.getByTestId('reader-page'))

    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Словарь урока' })).toBeInTheDocument()
  })

  it('dismisses a pinned list before Escape exits the reader', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    renderPage()
    await screen.findByTestId('page-view-slot')
    fireEvent.click(screen.getByRole('button', { name: 'Показать словарь урока' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Словарь урока' })).not.toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/learn/$lang/library',
      params: { lang: 'en' },
    })
  })

  it('renders saved phrase underlay and opens phrase card on click', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.phrases).mockResolvedValue([
      { item_id: 'ph1', phrase_text: 'hello world', status: 'tracked', confidence: 1 },
    ])
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'ph1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderPage()

    const phrase = await screen.findByTestId('phrase-span')
    fireEvent.click(phrase)
    expect(await screen.findByTestId('word-card')).toBeInTheDocument()
  })

  it('keeps the clicked word highlighted while its card is open and clears on close', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    const hello = await screen.findByRole('button', { name: 'Hello' })
    fireEvent.click(hello)
    const card = await screen.findByTestId('word-card')

    expect(hello.className).toContain('bg-primary/20')
    expect(screen.getByRole('button', { name: 'world' }).className).not.toContain('bg-primary/20')

    fireEvent.click(within(card).getByRole('button', { name: 'Закрыть карточку' }))
    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
    expect(hello.className).not.toContain('bg-primary/20')
  })

  it('keeps the dragged phrase highlighted while its card is open', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    const hello = screen.getByRole('button', { name: 'Hello' })
    const world = screen.getByRole('button', { name: 'world' })

    fireEvent(
      hello,
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )
    fireEvent(
      world,
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )
    fireEvent(
      world,
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 0 }),
    )

    const card = await screen.findByTestId('word-card')
    expect(hello.className).toContain('bg-primary/20')
    expect(world.className).toContain('bg-primary/20')

    fireEvent.click(within(card).getByRole('button', { name: 'Закрыть карточку' }))
    expect(hello.className).not.toContain('bg-primary/20')
    expect(world.className).not.toContain('bg-primary/20')
  })

  it('передаёт lesson_id и segment_id предложения при добавлении фразы', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 'ph1',
      status: 'tracked',
      confidence: 1,
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    const hello = screen.getByRole('button', { name: 'Hello' })
    const world = screen.getByRole('button', { name: 'world' })

    // Тянем фразу "Hello world" — оба слова принадлежат seg-1.
    fireEvent(
      hello,
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )
    fireEvent(
      world,
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )
    fireEvent(
      world,
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 0 }),
    )

    await screen.findByTestId('word-card')
    fireEvent.click(await screen.findByRole('button', { name: 'Уровень 1' }))

    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'phrase', lesson_id: 'lesson-1', segment_id: 'seg-1' }),
      )
    })
  })

  it('clears the selection highlight when a status is applied but keeps the card open', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 't1',
      status: 'tracked',
      confidence: 1,
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
      external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })

    renderPage()

    await screen.findByTestId('page-view-slot')
    const hello = await screen.findByRole('button', { name: 'Hello' })
    fireEvent.click(hello)
    await screen.findByTestId('word-card')
    expect(hello.className).toContain('bg-primary/20')

    const knownIconPath = (await screen.findByRole('button', { name: 'Изучено' })).querySelector(
      'svg path',
    )
    expect(knownIconPath).not.toBeNull()
    fireEvent.click(knownIconPath!)

    await waitFor(() => expect(hello.className).not.toContain('bg-primary/20'))
    expect(screen.getByTestId('word-card')).toBeInTheDocument()
  })

  it('Escape during an active phrase drag cancels the drag instead of navigating to the library', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    renderPage()

    await screen.findByTestId('page-view-slot')

    const helloWord = screen.getByRole('button', { name: 'Hello' })
    const worldWord = screen.getByRole('button', { name: 'world' })

    fireEvent(
      helloWord,
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )
    fireEvent(
      worldWord,
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    // The drag was cancelled (not finalized into a phrase selection), and the
    // reader did NOT navigate away to the library — only the drag was cancelled.
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('page-view-slot')).toBeInTheDocument()

    fireEvent(
      worldWord,
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, buttons: 0 }),
    )
    expect(screen.queryByTestId('word-card')).not.toBeInTheDocument()
  })

  it('кнопка «Повторить лексику» ведёт на review с lessonId', async () => {
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})

    renderPage()

    const btn = await screen.findByRole('button', { name: /Повторить лексику/ })
    expect((btn as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(btn)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/learn/$lang/review',
      params: { lang: 'en' },
      search: { lessonId: 'lesson-1' },
    })
  })

  it('persists the page-end ordinal, not the page-start ordinal, for a lesson that fits on one page', async () => {
    // `content` is 4 words total — a single page (PAGE_SIZE_WORDS is 250), so
    // fromOrdinal is 0 for the whole lesson. Before this fix the reader
    // persisted fromOrdinal, so a lesson like this could never show more than
    // 0% in the library no matter how completely it was read.
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(content)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(readerApi.putPosition).mockResolvedValue(undefined)

    renderPage()

    await screen.findByTestId('page-view-slot')

    // TanStack Query v5 calls mutationFn(variables, context) — a second,
    // internal context argument is always present, so assert on each call's
    // first argument rather than the full call signature (see
    // usePositionSync.test.tsx's callArgs helper for the same pattern).
    await waitFor(
      () => {
        const calls = vi.mocked(readerApi.putPosition).mock.calls.map((call) => call[0])
        expect(calls).toContainEqual({
          lesson_id: 'lesson-1',
          source_version: 1,
          view_mode: 'page',
          current_segment_id: 'seg-1',
          current_token_ordinal: 3,
        })
      },
      { timeout: 3000 },
    )
  })

  it('sends null instead of a negative ordinal for a page with no word tokens', async () => {
    const punctuationOnlyContent: LessonContent = {
      lesson_id: 'lesson-1',
      source_version: 1,
      language_code: 'en',
      word_count: 0,
      paragraphs: [
        {
          sentences: [
            {
              seg_id: 'seg-punct',
              index: 0,
              text: '…',
              normalized_text: '…',
              tokens: [{ p: '…' }],
            },
          ],
        },
      ],
    }
    vi.mocked(lessonsApi.get).mockResolvedValue(baseLesson)
    vi.mocked(readerApi.content).mockResolvedValue(punctuationOnlyContent)
    vi.mocked(readerApi.statuses).mockResolvedValue({})
    vi.mocked(readerApi.putPosition).mockResolvedValue(undefined)

    renderPage()

    await screen.findByTestId('page-view-slot')

    await waitFor(
      () => {
        const calls = vi.mocked(readerApi.putPosition).mock.calls.map((call) => call[0])
        expect(calls).toContainEqual({
          lesson_id: 'lesson-1',
          source_version: 1,
          view_mode: 'page',
          current_segment_id: 'seg-punct',
          current_token_ordinal: null,
        })
      },
      { timeout: 3000 },
    )
  })
})
