import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('@/test/routerLinkMock')).MockLink,
}))

import type { LessonSummary } from '@/api/lessons'

import { setUiLanguage } from '@/lib/i18n'

import { LessonCard } from './LessonCard'
import { useLibraryStore } from './libraryStore'

const lesson: LessonSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Capítulo 14 — Um Mapa das Índias',
  language_code: 'pt',
  word_count: 1240,
  visibility: 'private',
  status: 'ready',
  created_at: '2026-07-25T00:00:00Z',
  read_percent: 42,
  new_words_remaining: 87,
  can_manage: true,
}

describe('LessonCard', () => {
  it('uses localized word count forms for one, two and five words', () => {
    setUiLanguage('en')
    const { rerender } = render(
      <LessonCard lesson={{ ...lesson, word_count: 1, new_words_remaining: 1 }} />,
    )
    expect(screen.getByText('42% · 1 word · 1 new')).toBeInTheDocument()
    rerender(<LessonCard lesson={{ ...lesson, word_count: 2, new_words_remaining: 2 }} />)
    expect(screen.getByText('42% · 2 words · 2 new')).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByText('42% · 2 слова · 2 новых')).toBeInTheDocument()
    rerender(<LessonCard lesson={{ ...lesson, word_count: 1, new_words_remaining: 1 }} />)
    expect(screen.getByText('42% · 1 слово · 1 новое')).toBeInTheDocument()
    rerender(<LessonCard lesson={{ ...lesson, word_count: 5, new_words_remaining: 5 }} />)
    expect(screen.getByText('42% · 5 слов · 5 новых')).toBeInTheDocument()
  })

  afterEach(() => {
    act(() => setUiLanguage('ru'))
  })
  it('renders English progress while preserving lesson content', () => {
    setUiLanguage('en')
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByRole('progressbar', { name: 'Read 42%' })).toBeInTheDocument()
    expect(screen.getByText(lesson.title)).toBeInTheDocument()
    expect(screen.getByText('42% · 1240 words · 87 new')).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('progressbar', { name: 'Прочитано 42%' })).toBeInTheDocument()
    expect(screen.getByText(lesson.title)).toBeInTheDocument()
  })

  it('links the card to the reader of this lesson', () => {
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByRole('link', { name: new RegExp(lesson.title) })).toHaveAttribute(
      'href',
      `/learn/pt/lessons/${lesson.id}`,
    )
  })

  it('fills the progress bar to the read percentage', () => {
    render(<LessonCard lesson={lesson} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar.firstElementChild).toHaveStyle({ width: '42%' })
  })

  it('gives the progress bar an accessible name carrying the percentage', () => {
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByRole('progressbar', { name: 'Прочитано 42%' })).toBeInTheDocument()
  })

  it('shows percent read, total words and remaining new words', () => {
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByText('42% · 1240 слов · 87 новых')).toBeInTheDocument()
  })

  it('renders an untouched lesson at zero without collapsing the bar', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 0, new_words_remaining: 1240 }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.firstElementChild).toHaveStyle({ width: '0%' })
    expect(screen.getByText('0% · 1240 слов · 1240 новых')).toBeInTheDocument()
  })

  it('renders a finished lesson at a hundred percent', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 100, new_words_remaining: 0 }} />)
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '100%' })
    expect(screen.getByText('100% · 1240 слов · 0 новых')).toBeInTheDocument()
  })

  it('marks a lesson without activity as not started', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 0, last_activity_at: null }} />)
    expect(screen.getByText('Не начат')).toBeInTheDocument()
  })

  it('does not call a started or completed lesson not started', () => {
    const { rerender } = render(
      <LessonCard lesson={{ ...lesson, last_activity_at: '2026-09-26T09:00:00Z' }} />,
    )
    expect(screen.queryByText('Не начат')).not.toBeInTheDocument()
    rerender(<LessonCard lesson={{ ...lesson, completed_at: '2026-09-26T09:00:00Z' }} />)
    expect(screen.queryByText('Не начат')).not.toBeInTheDocument()
    expect(screen.getByText(/Материал завершён/)).toBeInTheDocument()
  })

  it('shows the last study day only in the continue variant', () => {
    const started = { ...lesson, last_activity_at: new Date(2026, 8, 25, 20).toISOString() }
    const today = new Date(2026, 8, 26, 12)
    const { rerender } = render(<LessonCard lesson={started} variant="continue" today={today} />)
    expect(screen.getByText('Последнее занятие: вчера')).toBeInTheDocument()
    rerender(<LessonCard lesson={started} variant="history" today={today} />)
    expect(screen.queryByText(/Последнее занятие/)).not.toBeInTheDocument()
  })

  it('does not call an opened lesson with progress not started', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 15, last_activity_at: null }} />)
    expect(screen.queryByText('Не начат')).not.toBeInTheDocument()
  })

  it('shows up to three tag chips that filter the library without opening the lesson', () => {
    act(() => setUiLanguage('ru'))
    useLibraryStore.getState().reset()
    render(<LessonCard lesson={{ ...lesson, tags: ['a', 'b', 'c', 'd'] }} />)
    const chip = screen.getByRole('button', { name: 'Фильтровать по тегу «a»' })
    expect(chip.closest('a')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Фильтровать по тегу «d»' })).toBeNull()
    expect(screen.getByText('+1')).toHaveAttribute('title', 'd')
    fireEvent.click(chip)
    expect(useLibraryStore.getState()).toMatchObject({ tagsLang: 'pt', tags: ['a'] })
  })
})
