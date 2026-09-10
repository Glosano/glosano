import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { LessonVocabularyItem, LessonVocabularyResponse } from '@/api/reader'

vi.mock('@/api/reader', () => ({
  readerApi: { vocabulary: vi.fn() },
}))
vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: { createItem: vi.fn(), patchItem: vi.fn() },
}))

import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'

import { LessonVocabularyList } from './LessonVocabularyList'

const item = (
  text: string,
  overrides: Partial<LessonVocabularyItem> = {},
): LessonVocabularyItem => ({
  kind: 'token',
  item_id: null,
  text,
  display_text: text,
  status: 'new',
  confidence: null,
  primary_translation: null,
  added_here: false,
  context: { segment_id: `seg-${text}`, token_ordinal: 1, sentence_text: `${text}.` },
  ...overrides,
})

const snapshot: LessonVocabularyResponse = {
  lesson_id: 'lesson-1',
  language_code: 'pt',
  items: [
    item('casa', { display_text: 'Casa' }),
    item('rua'),
    item('ação', { item_id: 'tracked-zero', status: 'tracked', confidence: 0, added_here: true }),
    item('fora', { item_id: 'tracked-elsewhere', status: 'tracked', confidence: 2 }),
    item('livro', { item_id: 'known-here', status: 'known', added_here: true }),
    item('nome', { item_id: 'ignored', status: 'ignored' }),
    item('casa azul', { kind: 'phrase', item_id: 'phrase', status: 'tracked', confidence: 3 }),
  ],
}

function renderList(tab: 'added' | 'new' | 'all') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <LessonVocabularyList
        lessonId="lesson-1"
        lang="pt"
        target="ru"
        tab={tab}
        onTabChange={() => undefined}
        scrollTop={0}
        onScrollTopChange={() => undefined}
        onSelect={() => undefined}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readerApi.vocabulary).mockResolvedValue(snapshot)
})

it('filters real snapshot rows by provenance and status', async () => {
  const { rerender } = renderList('added')

  const added = await screen.findByRole('list', { name: 'Добавленные слова' })
  expect(within(added).getAllByRole('listitem')).toHaveLength(2)
  expect(within(added).getByText('ação')).toBeInTheDocument()
  expect(within(added).getByText('livro')).toBeInTheDocument()
  expect(within(added).queryByText('casa')).not.toBeInTheDocument()

  rerender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LessonVocabularyList
        lessonId="lesson-1"
        lang="pt"
        target="ru"
        tab="new"
        onTabChange={() => undefined}
        scrollTop={0}
        onScrollTopChange={() => undefined}
        onSelect={() => undefined}
      />
    </QueryClientProvider>,
  )
  const fresh = await screen.findByRole('list', { name: 'Новые слова' })
  expect(within(fresh).getAllByRole('listitem')).toHaveLength(2)
  expect(within(fresh).getByText('Casa')).toBeInTheDocument()
  expect(within(fresh).getByText('rua')).toBeInTheDocument()
  expect(within(fresh).queryByText('ação')).not.toBeInTheDocument()
})

it('exposes bottom tabs and reports scroll position', async () => {
  const onTabChange = vi.fn()
  const onScrollTopChange = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <LessonVocabularyList
        lessonId="lesson-1"
        lang="pt"
        target="ru"
        tab="all"
        onTabChange={onTabChange}
        scrollTop={45}
        onScrollTopChange={onScrollTopChange}
        onSelect={() => undefined}
      />
    </QueryClientProvider>,
  )

  expect(await screen.findByRole('tab', { name: 'Все', selected: true })).toBeInTheDocument()
  const newTab = screen.getByRole('tab', { name: 'Новые' })
  fireEvent.keyDown(newTab, { key: 'Enter' })
  expect(onTabChange).toHaveBeenCalledWith('new')
  const list = screen.getByTestId('lesson-vocabulary-scroll')
  expect(list.scrollTop).toBe(45)
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 91 })
  fireEvent.scroll(list)
  expect(onScrollTopChange).toHaveBeenCalledWith(91)
})

it('moves focus to the same action on the next row after a successful removal', async () => {
  const initial = {
    ...snapshot,
    items: [item('casa', { display_text: 'Casa' }), item('rua', { display_text: 'Rua' })],
  }
  const refreshed = {
    ...initial,
    items: [
      item('casa', {
        display_text: 'Casa',
        item_id: 'casa-1',
        status: 'tracked',
        confidence: 1,
        added_here: true,
      }),
      item('rua', { display_text: 'Rua' }),
    ],
  }
  vi.mocked(readerApi.vocabulary).mockResolvedValueOnce(initial).mockResolvedValue(refreshed)
  vi.mocked(vocabularyApi.createItem).mockResolvedValue({
    item_id: 'casa-1',
    status: 'tracked',
    confidence: 1,
  })

  renderList('new')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить Casa в изучение' }))

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Открыть карточку Casa' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: 'Добавить Rua в изучение' })).toHaveFocus()
})

it('keeps the snapshot and labels a failed refresh separately from a successful write', async () => {
  const initial = { ...snapshot, items: [item('casa', { display_text: 'Casa' })] }
  vi.mocked(readerApi.vocabulary)
    .mockResolvedValueOnce(initial)
    .mockRejectedValue(new Error('refresh offline'))
  vi.mocked(vocabularyApi.createItem).mockResolvedValue({
    item_id: 'casa-1',
    status: 'tracked',
    confidence: 1,
  })

  renderList('new')
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить Casa в изучение' }))

  expect(await screen.findByText('Не удалось обновить список.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Открыть карточку Casa' })).toBeInTheDocument()
  expect(screen.queryByText('Не удалось сохранить')).not.toBeInTheDocument()
})

it('shows the initial load error and retries it without hiding the tabs', async () => {
  vi.mocked(readerApi.vocabulary)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(snapshot)

  renderList('all')
  expect(await screen.findByText('Не удалось загрузить слова')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Все', selected: true })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByRole('button', { name: 'Открыть карточку Casa' })).toBeInTheDocument()
})
