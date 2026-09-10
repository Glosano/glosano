import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LessonVocabularyPanel } from './LessonVocabularyPanel'
import { useReaderStore } from './readerStore'
import type { SelectedItem } from './selectedItem'

const selected: SelectedItem = {
  kind: 'token',
  t: 'Casa',
  n: 'casa',
  i: 0,
  segmentId: 'seg-1',
  sentenceText: 'Casa azul.',
}

function installMatchMedia(desktop: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: desktop,
    media: '(min-width: 1024px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  return {
    resize(next: boolean) {
      Object.defineProperty(query, 'matches', { configurable: true, value: next })
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent))
    },
  }
}

function FakeList({
  tab,
  onTabChange,
  scrollTop,
  onScrollTopChange,
}: {
  tab: 'added' | 'new' | 'all'
  onTabChange: (tab: 'added' | 'new' | 'all') => void
  scrollTop: number
  onScrollTopChange: (top: number) => void
}) {
  return (
    <div data-testid="fake-list" data-tab={tab} data-scroll-top={scrollTop}>
      <button type="button" onClick={() => onTabChange('new')}>
        Новые
      </button>
      <button type="button" onClick={() => onScrollTopChange(120)}>
        Прокрутить
      </button>
    </div>
  )
}

function PanelHarness({ lessonId, pinned = true }: { lessonId: string; pinned?: boolean }) {
  const [word, setWord] = useState<SelectedItem | null>(null)
  return (
    <LessonVocabularyPanel
      key={lessonId}
      lessonId={lessonId}
      pinned={pinned}
      selectedWord={word}
      onClearSelection={() => setWord(null)}
      onHide={() => setWord(null)}
      card={word ? <div data-testid="test-card">Карточка</div> : null}
      renderList={(state) => <FakeList {...state} />}
    />
  )
}

describe('LessonVocabularyPanel', () => {
  beforeEach(() => installMatchMedia(true))
  afterEach(() => vi.unstubAllGlobals())

  it('stays hidden when neither pinned nor showing a temporary card', () => {
    render(
      <LessonVocabularyPanel
        lessonId="lesson-1"
        pinned={false}
        selectedWord={null}
        onClearSelection={() => {}}
        onHide={() => {}}
        card={null}
        renderList={() => <div>Список</div>}
      />,
    )

    expect(screen.queryByRole('complementary', { name: 'Словарь урока' })).not.toBeInTheDocument()
  })

  it('renders one desktop complementary shell and exposes list state through renderList', () => {
    const { rerender } = render(<PanelHarness lessonId="lesson-1" />)
    const panel = screen.getByRole('complementary', { name: 'Словарь урока' })
    expect(panel).toHaveAttribute('data-reader-panel')
    expect(screen.getByRole('heading', { name: 'Словарь урока' })).toBeInTheDocument()
    expect(screen.getByTestId('fake-list')).toHaveAttribute('data-tab', 'added')

    fireEvent.click(screen.getByRole('button', { name: 'Новые' }))
    fireEvent.click(screen.getByRole('button', { name: 'Прокрутить' }))
    expect(screen.getByTestId('fake-list')).toHaveAttribute('data-tab', 'new')
    expect(screen.getByTestId('fake-list')).toHaveAttribute('data-scroll-top', '120')

    rerender(<PanelHarness lessonId="lesson-2" />)
    expect(screen.getByTestId('fake-list')).toHaveAttribute('data-tab', 'added')
    expect(screen.getByTestId('fake-list')).toHaveAttribute('data-scroll-top', '0')
  })

  it('uses one mobile modal sheet and restores focus when it closes', () => {
    installMatchMedia(false)
    const onHide = vi.fn()
    const opener = document.createElement('button')
    opener.textContent = 'Открыть'
    document.body.append(opener)
    opener.focus()

    const { rerender } = render(
      <LessonVocabularyPanel
        lessonId="lesson-1"
        pinned
        selectedWord={null}
        onClearSelection={() => {}}
        onHide={onHide}
        card={null}
        renderList={() => <button type="button">Строка</button>}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Словарь урока' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onHide).toHaveBeenCalledTimes(1)

    rerender(
      <LessonVocabularyPanel
        lessonId="lesson-1"
        pinned={false}
        selectedWord={null}
        onClearSelection={() => {}}
        onHide={onHide}
        card={null}
        renderList={() => null}
      />,
    )
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('keeps one card and list state when the breakpoint changes', () => {
    const viewport = installMatchMedia(true)
    const renderList = vi.fn(
      (state: Parameters<Parameters<typeof LessonVocabularyPanel>[0]['renderList']>[0]) => (
        <FakeList {...state} />
      ),
    )

    render(
      <LessonVocabularyPanel
        lessonId="lesson-1"
        pinned
        selectedWord={selected}
        onClearSelection={() => {}}
        onHide={() => {}}
        card={<div data-testid="test-card">Карточка</div>}
        renderList={renderList}
      />,
    )
    expect(screen.getAllByTestId('test-card')).toHaveLength(1)

    act(() => viewport.resize(false))
    expect(screen.getAllByTestId('test-card')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Словарь урока' })).toBeInTheDocument()
  })

  it('keeps the pinned list mounted but inert while a card is visible', () => {
    render(
      <LessonVocabularyPanel
        lessonId="lesson-1"
        pinned
        selectedWord={selected}
        onClearSelection={() => {}}
        onHide={() => {}}
        card={<div data-testid="test-card">Карточка</div>}
        renderList={() => <button type="button">Строка списка</button>}
      />,
    )

    const listSlot = screen.getByTestId('lesson-vocabulary-list-slot')
    expect(listSlot).toHaveAttribute('inert')
    expect(listSlot).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Строка списка', hidden: true })).toBeInTheDocument()
    expect(screen.getByTestId('test-card')).toBeInTheDocument()
  })

  it('persists and rehydrates only panel pinning alongside font preferences', async () => {
    localStorage.clear()
    useReaderStore.setState({
      mode: 'sentence',
      vocabularyPanelPinned: false,
      font: { size: 2, lineHeight: 0, serif: true },
    })
    useReaderStore.getState().setVocabularyPanelPinned(true)

    const stored = JSON.parse(localStorage.getItem('flinq-reader-prefs') ?? '{}')
    expect(stored.state).toEqual({
      vocabularyPanelPinned: true,
      font: { size: 2, lineHeight: 0, serif: true },
    })

    useReaderStore.setState({
      mode: 'page',
      vocabularyPanelPinned: false,
      font: { size: 0, lineHeight: 2, serif: false },
    })
    localStorage.setItem('flinq-reader-prefs', JSON.stringify(stored))
    await useReaderStore.persist.rehydrate()

    expect(useReaderStore.getState().vocabularyPanelPinned).toBe(true)
    expect(useReaderStore.getState().font).toEqual({ size: 2, lineHeight: 0, serif: true })
    expect(useReaderStore.getState().mode).toBe('page')
  })
})
