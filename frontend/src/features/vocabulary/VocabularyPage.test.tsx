import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, className, to }: { children?: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to}>{children}</a>
  ),
}))

vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: {
    list: vi.fn(), bulk: vi.fn(),
    lookup: vi.fn(), createItem: vi.fn(), patchItem: vi.fn(),
    addTranslation: vi.fn(), updateTranslation: vi.fn(), deleteTranslation: vi.fn(),
    putNote: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(),
  },
}))
vi.mock('@/api/dictionary', () => ({ dictionaryApi: { lookup: vi.fn() } }))
vi.mock('@/api/ai', () => ({ aiApi: { translate: vi.fn() } }))

// jsdom doesn't implement scrollIntoView, which the radix Select popup uses
// when it opens to scroll the highlighted item into view.
Element.prototype.scrollIntoView = vi.fn()

import { vocabularyApi } from '@/api/vocabulary'
import { dictionaryApi } from '@/api/dictionary'
import { aiApi } from '@/api/ai'
import type { VocabListItem } from '@/api/vocabulary'

import { addedAfterFromPreset, VocabularyPage } from './VocabularyPage'
import { useVocabularyStore } from './vocabularyStore'
import { setUiLanguage } from '@/lib/i18n'

afterEach(() => { setUiLanguage('ru') })

describe('addedAfterFromPreset', () => {
  it('added_after is stable across renders within the same day (no infinite refetch loop)', async () => {
    const first = addedAfterFromPreset('7d')
    await new Promise((r) => setTimeout(r, 5))
    const second = addedAfterFromPreset('7d')

    expect(first).toBe(second)
  })

  it('returns undefined for the "all" preset', () => {
    expect(addedAfterFromPreset('all')).toBeUndefined()
  })
})

const DEFAULT_STATUSES: ('tracked' | 'known' | 'ignored')[] = ['tracked', 'known', 'ignored']

const item: VocabListItem = {
  item_id: 'i1',
  kind: 'token',
  text: 'abaixaram',
  status: 'tracked',
  confidence: 2,
  primary_translation: { text: 'опустили', target_language_code: 'ru' },
  tags: [],
  pos: null,
  context: null,
  created_at: '2026-01-01T00:00:00Z',
}

function resetStore() {
  useVocabularyStore.setState({
    q: '',
    statuses: DEFAULT_STATUSES,
    confidence: null,
    tags: [],
    addedPreset: 'all',
    sort: 'created_at',
    sortDir: 'desc',
    page: 1,
    pageSize: 25,
    selection: [],
    showAuto: false,
  })
}

function renderPage(tab: 'all' | 'words' | 'phrases' | 'due' = 'all') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <VocabularyPage lang="pt" tab={tab} />
    </QueryClientProvider>,
  )
}

describe('VocabularyPage states', () => {
  beforeEach(() => {
    setUiLanguage('ru')
    vi.clearAllMocks()
    resetStore()
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [], attribution: { source: '', license: '', url: '' }, external_links: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })
  })

  it('renders English controls and switches vocabulary and card targets without rewriting saved text', async () => {
    setUiLanguage('en')
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'i1', status: 'tracked', confidence: 2,
      translations: { primary: null, all: [] }, note: null, tags: [],
    })
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: 'abaixaram' }))[0]!)
    expect(screen.getByRole('heading', { name: 'Vocabulary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search vocabulary')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort order' })).toBeInTheDocument()
    expect(screen.getByText('Newest first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getAllByText('опустили')).toHaveLength(2)
    await waitFor(() => expect(vocabularyApi.lookup).toHaveBeenCalledWith('pt', 'abaixaram', 'en', 'token'))
    expect(vocabularyApi.list).toHaveBeenCalledWith(expect.objectContaining({ target: 'en' }))

    act(() => { setUiLanguage('ru') })
    await waitFor(() => expect(vocabularyApi.lookup).toHaveBeenCalledWith('pt', 'abaixaram', 'ru', 'token'))
    expect(vocabularyApi.list).toHaveBeenCalledWith(expect.objectContaining({ target: 'ru' }))
    expect(screen.getByRole('heading', { name: 'Словарь' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Поиск в словаре')).toBeInTheDocument()
    expect(vocabularyApi.updateTranslation).not.toHaveBeenCalled()
    expect(vocabularyApi.addTranslation).not.toHaveBeenCalled()
  })

  it('does not show previous-target vocabulary as placeholder data while a new target is loading', async () => {
    vi.mocked(vocabularyApi.list).mockImplementation((params) => params.target === 'ru'
      ? Promise.resolve({ items: [item], total: 1, page: 1, page_size: 25 })
      : new Promise(() => {}))
    renderPage()
    await screen.findAllByText('опустили')
    act(() => { setUiLanguage('en') })
    expect(screen.queryByText('опустили')).not.toBeInTheDocument()
    expect(screen.getByTestId('vocab-skeleton')).toBeInTheDocument()
  })

  it('shows the empty-default state with a CTA to the library when the vocab is empty and filters are default', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 })

    renderPage()

    expect(await screen.findByTestId('vocab-empty-default')).toHaveTextContent('В словаре пока пусто')
    expect(screen.getByText(
      'Начните с импорта урока — нажимайте на слова в reader, и они появятся здесь',
    )).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Перейти в библиотеку' })
    expect(cta).toHaveAttribute('href', '/learn/$lang/library')
  })

  it('shows the filtered-empty state with a reset button when the store has q set', async () => {
    useVocabularyStore.setState({ q: 'zzz' })
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 })

    renderPage()

    expect(await screen.findByTestId('vocab-empty-filtered')).toHaveTextContent('Ничего не найдено по текущим фильтрам')
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    expect(useVocabularyStore.getState().q).toBe('')
  })

  it('shows an inline error with a retry button when the list query fails', async () => {
    vi.mocked(vocabularyApi.list).mockRejectedValue(new Error('network down'))

    renderPage()

    expect(await screen.findByTestId('vocab-error')).toHaveTextContent('Не удалось загрузить словарь')
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => {
      expect(screen.queryByTestId('vocab-error')).not.toBeInTheDocument()
    })
  })

  it('opens the WordCard when a term is clicked and invalidates the list on close', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'i1', status: 'tracked', confidence: 2,
      translations: { primary: null, all: [] }, note: null, tags: [],
    })

    renderPage()

    const termButtons = await screen.findAllByRole('button', { name: 'abaixaram' })
    fireEvent.click(termButtons[0]!)

    expect(await screen.findByTestId('word-card')).toBeInTheDocument()
  })

  it('sends added_by=user by default', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await waitFor(() => {
      expect(vocabularyApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ added_by: 'user' }),
      )
    })
  })

  it('sends added_by=all when showAuto is set in the store', async () => {
    useVocabularyStore.setState({ showAuto: true })
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await waitFor(() => {
      expect(vocabularyApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ added_by: 'all' }),
      )
    })
  })

  it('renders the «Показать:» label next to the page-size select', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await screen.findAllByRole('button', { name: 'abaixaram' })
    expect(screen.getByText('Показать:')).toBeInTheDocument()
  })

  it('changing the sort select requests the new sort and resets the page to 1', async () => {
    useVocabularyStore.setState({ page: 3 })
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 100, page: 1, page_size: 25 })

    renderPage()

    await screen.findAllByRole('button', { name: 'abaixaram' })

    fireEvent.click(screen.getByRole('combobox', { name: 'Сортировка' }))
    fireEvent.click(await screen.findByText('А–Я'))

    await waitFor(() => {
      expect(vocabularyApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'text', sort_dir: 'asc', page: 1 }),
      )
    })
    expect(useVocabularyStore.getState().page).toBe(1)
  })

  it('clamps the page down to totalPages when the current page is out of range', async () => {
    useVocabularyStore.setState({ page: 5 })
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await waitFor(() => {
      expect(useVocabularyStore.getState().page).toBe(1)
    })
  })

  it('patches a phrase row with kind=phrase (not the hardcoded token), so it hits the right endpoint', async () => {
    const phraseItem: VocabListItem = {
      item_id: 'p1',
      kind: 'phrase',
      text: 'so far, so good',
      status: 'tracked',
      confidence: 1,
      primary_translation: null,
      tags: [],
      pos: null,
      context: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [phraseItem], total: 1, page: 1, page_size: 25 })
    vi.mocked(vocabularyApi.patchItem).mockResolvedValue({ item_id: 'p1', status: 'tracked', confidence: 3 })

    renderPage()

    const pills = await screen.findAllByRole('button', { name: 'Уровень 3' })
    fireEvent.click(pills[0]!)

    await waitFor(() => {
      expect(vocabularyApi.patchItem).toHaveBeenCalledWith('phrase', 'p1', { status: 'tracked', confidence: 3 })
    })
  })

  it('renders the tabs as a segmented control with the active tab styled and the due placeholder', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await screen.findAllByRole('button', { name: 'abaixaram' })

    const allLink = screen.getByRole('link', { name: 'Все' })
    expect(allLink).toBeInTheDocument()
    expect(allLink.className).toContain('font-semibold')
    expect(screen.getByRole('link', { name: 'Слова' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Фразы' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Фразы' })).toBeNull()

    const dueButton = screen.getByRole('button', { name: 'К повторению' })
    expect(dueButton).toBeDisabled()
    expect(dueButton).toHaveAttribute('title', 'Появится позже')
  })

  it('renders the «⟳ Повтор лексики» button and navigates to the global review route on click', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [item], total: 1, page: 1, page_size: 25 })

    renderPage()

    await screen.findAllByRole('button', { name: 'abaixaram' })

    const reviewButton = screen.getByRole('button', { name: '⟳ Повтор лексики' })
    fireEvent.click(reviewButton)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/learn/$lang/review',
      params: { lang: 'pt' },
    })
  })

  it('lists only phrases on the phrases tab and highlights it', async () => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 })

    renderPage('phrases')

    await waitFor(() => {
      expect(vocabularyApi.list).toHaveBeenCalledWith(expect.objectContaining({ lang: 'pt', kind: 'phrase' }))
    })
    expect(screen.getByRole('link', { name: 'Фразы' }).className).toContain('font-semibold')
    expect(screen.getByRole('link', { name: 'Все' }).className).not.toContain('font-semibold')
  })

  it.each([
    ['phrases', 'phrase'],
    ['words', 'token'],
  ] as const)('starts a review of the %s tab kind only', async (tab, kind) => {
    vi.mocked(vocabularyApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 })

    renderPage(tab)

    fireEvent.click(screen.getByRole('button', { name: '⟳ Повтор лексики' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/learn/$lang/review',
      params: { lang: 'pt' },
      search: { kind },
    })
  })
})
