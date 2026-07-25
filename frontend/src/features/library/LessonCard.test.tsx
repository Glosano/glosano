import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LessonSummary } from '@/api/lessons'

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
  it('fills the progress bar to the read percentage', () => {
    render(<LessonCard lesson={lesson} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar.style.width).toBe('42%')
  })

  it('shows percent read, total words and remaining new words', () => {
    render(<LessonCard lesson={lesson} />)
    expect(screen.getByText('42% · 1240 слов · 87 новых')).toBeInTheDocument()
  })

  it('renders an untouched lesson at zero without collapsing the bar', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 0, new_words_remaining: 1240 }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.style.width).toBe('0%')
    expect(screen.getByText('0% · 1240 слов · 1240 новых')).toBeInTheDocument()
  })

  it('renders a finished lesson at a hundred percent', () => {
    render(<LessonCard lesson={{ ...lesson, read_percent: 100, new_words_remaining: 0 }} />)
    expect(screen.getByRole('progressbar').style.width).toBe('100%')
    expect(screen.getByText('100% · 1240 слов · 0 новых')).toBeInTheDocument()
  })
})
