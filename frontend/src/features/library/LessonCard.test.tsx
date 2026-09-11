import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { LessonSummary } from '@/api/lessons'

import { setUiLanguage } from '@/lib/i18n'

import { LessonCard } from './LessonCard'

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
})
