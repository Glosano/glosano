import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('@/test/routerLinkMock')).MockLink,
  useParams: () => ({ lang: 'pt' }),
}))

import { setUiLanguage } from '@/lib/i18n'
import { FilterRow } from './FilterRow'
import { LibraryEmptyState } from './LibraryEmptyState'
import { LessonCarousel } from './LessonCarousel'

afterEach(() => {
  act(() => setUiLanguage('ru'))
})

describe('Library localization', () => {
  it('shows localized import validation rather than a native required-field tooltip', () => {
    setUiLanguage('en')
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <FilterRow lang="pt" />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ Import lesson' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create lesson' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title and text')
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('alert')).toHaveTextContent('Заполните название и текст')
  })

  it('localizes search, import dialog labels and the close action live', async () => {
    setUiLanguage('en')
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <FilterRow lang="pt" />
      </QueryClientProvider>,
    )
    expect(screen.getByPlaceholderText('Search the library')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Import lesson' }))
    expect(await screen.findByRole('dialog', { name: 'Import lesson' })).toBeInTheDocument()
    expect(
      screen.getByText('Paste text for a new lesson in the current language (PT).'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('dialog', { name: 'Импорт урока' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать урок' })).toBeInTheDocument()
  })

  it('localizes empty state and carousel accessible controls', () => {
    setUiLanguage('en')
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <LibraryEmptyState />
        <LessonCarousel
          items={[
            {
              id: 'L1',
              title: 'Texto original',
              language_code: 'pt',
              word_count: 10,
              visibility: 'private',
              status: 'ready',
              created_at: '',
              read_percent: 0,
              new_words_remaining: 10,
              can_manage: true,
            },
          ]}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('You have no lessons yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('button', { name: 'Предыдущий' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Следующий' })).toBeInTheDocument()
    expect(screen.getByText('Texto original')).toBeInTheDocument()
  })
})
