import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { Sentence } from '@/api/reader'

vi.mock('@/api/reader', async () => {
  const actual = await vi.importActual<typeof import('@/api/reader')>('@/api/reader')
  return { ...actual, readerApi: { segmentTranslation: vi.fn() } }
})

import { readerApi } from '@/api/reader'

import { PageView } from './PageView'

const sentence = (seg_id: string, text: string): Sentence => ({
  seg_id,
  index: 0,
  text,
  normalized_text: text.toLowerCase(),
  tokens: [{ t: text, n: text.toLowerCase(), i: 0 }],
})

const page = {
  sentences: [
    { paragraphIndex: 0, sentence: sentence('seg-1', 'Hello') },
    { paragraphIndex: 0, sentence: sentence('seg-2', 'World') },
  ],
  fromOrdinal: 0,
  toOrdinal: 1,
  wordCount: 2,
}

function renderPage(overrides: Partial<ComponentProps<typeof PageView>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onWordClick = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <PageView
        page={page}
        lessonId="lesson-1"
        targetLang="ru"
        statuses={{}}
        phraseIndex={new Map()}
        dragRange={null}
        languageCode="en"
        onWordClick={onWordClick}
        {...overrides}
      />
    </QueryClientProvider>,
  )
  return { onWordClick }
}

const toggles = () => screen.getAllByRole('button', { name: 'Показать перевод предложения' })

describe('inline sentence translation in the page reader', () => {
  beforeEach(() => {
    vi.mocked(readerApi.segmentTranslation).mockReset()
  })

  it('puts one dot after every sentence and fetches nothing until clicked', () => {
    renderPage()
    expect(toggles()).toHaveLength(2)
    expect(readerApi.segmentTranslation).not.toHaveBeenCalled()
  })

  it('renders no dots without a lesson to translate', () => {
    renderPage({ lessonId: undefined, targetLang: undefined })
    expect(screen.queryByTestId('sentence-translation-toggle')).toBeNull()
  })

  it('loads the translation inline after the clicked sentence and hides it again', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof readerApi.segmentTranslation>>) => void
    vi.mocked(readerApi.segmentTranslation).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const { onWordClick } = renderPage()
    const dot = toggles()[1]!
    fireEvent.click(dot)

    expect(readerApi.segmentTranslation).toHaveBeenCalledWith('lesson-1', 'seg-2', 'ru')
    expect(onWordClick).not.toHaveBeenCalled()
    expect(dot).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('sentence-translation')).toBeNull()

    resolve({ text: 'Мир', source: 'ai', model: 'm', stored: false })
    const translation = await screen.findByTestId('sentence-translation')
    expect(translation).toHaveTextContent('Мир')
    expect(within(translation).getByText('AI')).toBeInTheDocument()
    const segment = document.querySelector('[data-segment-id="seg-2"]')!
    expect(segment).toContainElement(translation)

    const hide = screen.getByRole('button', { name: 'Скрыть перевод предложения' })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(hide)
    expect(screen.queryByTestId('sentence-translation')).toBeNull()

    fireEvent.click(toggles()[1]!)
    expect(screen.getByTestId('sentence-translation')).toHaveTextContent('Мир')
    expect(readerApi.segmentTranslation).toHaveBeenCalledTimes(1)
  })

  it('explains a disabled AI provider inline', async () => {
    vi.mocked(readerApi.segmentTranslation).mockRejectedValue(new ApiError(503, 'off'))
    renderPage()
    fireEvent.click(toggles()[0]!)
    expect(await screen.findByTestId('sentence-translation')).toHaveTextContent(
      'AI отключён администратором',
    )
  })

  it('retries a failed translation when the dot is clicked again', async () => {
    vi.mocked(readerApi.segmentTranslation)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ text: 'Привет', source: 'stored', model: 'm', stored: true })
    renderPage()
    fireEvent.click(toggles()[0]!)
    expect(await screen.findByTestId('sentence-translation')).toHaveTextContent(
      'Не удалось перевести',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть перевод предложения' }))
    fireEvent.click(toggles()[0]!)
    expect(await screen.findByText('Привет')).toBeInTheDocument()
    expect(screen.queryByText('AI')).toBeNull()
  })
})
