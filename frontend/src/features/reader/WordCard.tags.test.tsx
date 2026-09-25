import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { vocabularyApi, type WordLookup } from '@/api/vocabulary'
import { aiApi } from '@/api/ai'
import { dictionaryApi } from '@/api/dictionary'
import { ApiError } from '@/api/client'
import { WordCard } from './WordCard'
import { useReaderStore } from './readerStore'
import { useUserStore } from '@/stores/userStore'
import { setUiLanguage } from '@/lib/i18n'

vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: {
    lookup: vi.fn(),
    createItem: vi.fn(),
    patchItem: vi.fn(),
    addTags: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  },
}))
vi.mock('@/api/ai', () => ({ aiApi: { translate: vi.fn(), wordTags: vi.fn() } }))
vi.mock('@/api/dictionary', () => ({
  dictionaryApi: { lookup: vi.fn().mockResolvedValue({ entries: [] }) },
}))

let stored: WordLookup
const grammar = { tags: ['Глагол', 'ecoar', 'pretérito imperfeito'], model: 'test', latency_ms: 1 }
beforeEach(() => {
  vi.resetAllMocks()
  useUserStore.getState().reset()
  vi.mocked(dictionaryApi.lookup).mockResolvedValue({
    entries: [],
    attribution: { source: '', license: '', url: '' },
    external_links: [],
  })
  setUiLanguage('ru')
  useReaderStore.setState({ wordCardExpanded: false })
  stored = {
    item_id: 'I1',
    status: 'tracked',
    confidence: 1,
    tags: ['ecoar'],
    ai_tags: ['ecoar'],
    note: null,
    translations: { primary: null, all: [] },
  }
  vi.mocked(vocabularyApi.lookup).mockImplementation(async () => ({ ...stored }))
  vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: 'test', latency_ms: 1 })
  vi.mocked(aiApi.wordTags).mockResolvedValue(grammar)
  vi.mocked(vocabularyApi.createItem).mockImplementation(async () => {
    stored = { ...stored, item_id: 'I1', status: 'tracked', confidence: 1 }
    return { item_id: 'I1', status: 'tracked', confidence: 1 }
  })
  vi.mocked(vocabularyApi.addTag).mockImplementation(async (_kind, _id, name) => {
    stored = { ...stored, tags: [...new Set([...stored.tags, name])] }
    return { tags: stored.tags }
  })
  vi.mocked(vocabularyApi.addTags).mockImplementation(async (_kind, _id, tags) => {
    stored = { ...stored, tags: [...new Set([...stored.tags, ...tags])], ai_tags: tags }
    return { tags: stored.tags }
  })
  vi.mocked(vocabularyApi.removeTag).mockImplementation(async (_kind, _id, name) => {
    stored = { ...stored, tags: stored.tags.filter((t) => t !== name) }
    return { tags: stored.tags }
  })
})

function setup(onStatusApplied = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function card(text = 'ecoavam') {
    return (
      <QueryClientProvider client={client}>
        <WordCard
          word={{ kind: 'token', t: text, n: text, i: 0, sentenceText: null }}
          lang="pt"
          target="ru"
          lessonId={null}
          segId={null}
          onClose={() => {}}
          onStatusApplied={onStatusApplied}
          sentenceText={`Os sons ${text}.`}
        />
      </QueryClientProvider>
    )
  }
  return { ...render(card()), card }
}

it('shows durable AI tags in the collapsed header without making the tag clickable', async () => {
  setup()
  const tag = await screen.findByText('ecoar')
  expect(tag.closest('button')).toBeNull()
  expect(within(screen.getByTestId('word-tags')).getByText('AI')).toBeInTheDocument()
  fireEvent.click(tag)
  expect(vocabularyApi.removeTag).not.toHaveBeenCalled()
  expect(aiApi.wordTags).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Изменить теги' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить тег: ecoar' }))
  await waitFor(() => expect(screen.queryByText('ecoar')).not.toBeInTheDocument())
})

it('keeps manual editing usable when AI is disabled', async () => {
  vi.mocked(aiApi.wordTags).mockRejectedValue(new ApiError(503, 'ai_disabled'))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Получить AI-теги' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Получить AI-теги' })).not.toBeInTheDocument(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Тег+' }))
  const input = screen.getByRole('textbox', { name: 'Новый тег' })
  fireEvent.change(input, { target: { value: '  Глагол  ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByText('Глагол')
  expect(vocabularyApi.addTag).toHaveBeenCalledWith('token', 'I1', 'Глагол')
})

it('persists suggested tags when a new word is added and restores them on reopen', async () => {
  stored = { ...stored, item_id: null, status: 'new', tags: [], ai_tags: [] }
  const view = setup()
  await screen.findByText('Глагол')
  expect(vocabularyApi.createItem).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Уровень 1' }))
  await waitFor(() =>
    expect(vocabularyApi.addTags).toHaveBeenCalledWith('token', 'I1', grammar.tags, 'ai'),
  )
  view.unmount()
  vi.mocked(aiApi.wordTags).mockClear()
  setup()
  await screen.findByText('ecoar')
  expect(aiApi.wordTags).not.toHaveBeenCalled()
})

it('saves a pending AI response for the original word after a quick switch', async () => {
  stored = { ...stored, item_id: null, status: 'new', tags: [], ai_tags: [] }
  let finish!: (value: typeof grammar) => void
  vi.mocked(aiApi.wordTags).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  vi.mocked(vocabularyApi.lookup).mockImplementation(async (_lang, text) =>
    text === 'livros'
      ? { ...stored, item_id: 'I2', status: 'tracked', tags: ['livro'], ai_tags: [] }
      : { ...stored },
  )
  const view = setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Уровень 1' }))
  await waitFor(() => expect(vocabularyApi.createItem).toHaveBeenCalled())
  view.rerender(view.card('livros'))
  await act(async () => {
    finish(grammar)
  })
  await waitFor(() =>
    expect(vocabularyApi.addTags).toHaveBeenCalledWith('token', 'I1', grammar.tags, 'ai'),
  )
  expect(screen.getByText('livros')).toBeInTheDocument()
  expect(screen.queryByText('ecoar')).not.toBeInTheDocument()
})

it('keeps a failed manual tag draft for retry', async () => {
  vi.mocked(vocabularyApi.addTag).mockRejectedValueOnce(new Error('offline'))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Тег+' }))
  const input = screen.getByRole('textbox', { name: 'Новый тег' })
  fireEvent.change(input, { target: { value: 'Глагол' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByText('Не удалось сохранить теги')
  expect(input).toHaveValue('Глагол')
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByText('Глагол')
})

it('does not resurrect a deleted AI tag from query cache on reopening', async () => {
  const view = setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Получить AI-теги' }))
  await screen.findByText('Глагол')
  await waitFor(() => expect(vocabularyApi.addTags).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Изменить теги' }))
  fireEvent.click(screen.getByRole('button', { name: 'Удалить тег: ecoar' }))
  await waitFor(() => expect(screen.queryByText('ecoar')).not.toBeInTheDocument())
  view.rerender(<></>)
  view.rerender(view.card())
  await screen.findByText('Глагол')
  expect(screen.queryByText('ecoar')).not.toBeInTheDocument()
})

it('does not clear a later selection when a status request completes', async () => {
  let finish!: (value: { item_id: string; status: string; confidence: number }) => void
  vi.mocked(vocabularyApi.patchItem).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const applied = vi.fn()
  const view = setup(applied)
  fireEvent.click(await screen.findByRole('button', { name: 'Уровень 2' }))
  expect(applied).toHaveBeenCalledTimes(1)
  view.rerender(view.card('livros'))
  await act(async () => {
    finish({ item_id: 'I1', status: 'tracked', confidence: 2 })
  })
  expect(applied).toHaveBeenCalledTimes(1)
})

it('preserves selection when a manual tag implicitly saves a new word', async () => {
  stored = { ...stored, item_id: null, status: 'new', tags: [], ai_tags: [] }
  const applied = vi.fn()
  setup(applied)
  fireEvent.click(await screen.findByRole('button', { name: 'Тег+' }))
  const input = screen.getByRole('textbox', { name: 'Новый тег' })
  fireEvent.change(input, { target: { value: 'Повторить' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    expect(vocabularyApi.addTag).toHaveBeenCalledWith('token', 'I1', 'Повторить'),
  )
  expect(applied).not.toHaveBeenCalled()
})

it('hides AI controls when the profile says AI is disabled', async () => {
  useUserStore
    .getState()
    .setUser({
      id: 'U1',
      email: 'test@example.com',
      role: 'learner',
      display_name: 'Test',
      ui_language_code: 'ru',
      learning_languages: ['pt'],
      last_learning_language_code: 'pt',
      needs_onboarding: false,
      onboarded_at: null,
      ai_enabled: false,
    })
  setup()
  await screen.findByText('ecoar')
  expect(screen.queryByRole('button', { name: 'Получить AI-теги' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Тег+' })).toBeInTheDocument()
  expect(aiApi.wordTags).not.toHaveBeenCalled()
})
