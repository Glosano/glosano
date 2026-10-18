import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  },
}))
vi.mock('@/api/dictionary', () => ({ dictionaryApi: { lookup: vi.fn() } }))
vi.mock('@/api/externalDictionaries', () => ({
  externalDictionariesApi: { list: vi.fn() },
}))
vi.mock('@/api/ai', () => ({ aiApi: { translate: vi.fn(), wordTags: vi.fn().mockResolvedValue({ tags: [], model: '', latency_ms: 0 }) } }))

import { vocabularyApi } from '@/api/vocabulary'
import { dictionaryApi } from '@/api/dictionary'
import { externalDictionariesApi } from '@/api/externalDictionaries'
import { aiApi } from '@/api/ai'
import { ApiError } from '@/api/client'
import { useReaderStore } from './readerStore'
import { WordCard } from './WordCard'
import { setUiLanguage, useI18n } from '@/lib/i18n'

afterEach(() => { setUiLanguage('ru') })

function renderCard(
  sentenceText: string | null = null,
  lessonId: string | null = 'L1',
  segId: string | null = null,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <WordCard
        word={{ kind: 'token', t: 'cada', n: 'cada', i: 0, sentenceText: null }}
        lang="pt"
        target="ru"
        lessonId={lessonId}
        segId={segId}
        onClose={() => {}}
        sentenceText={sentenceText}
      />
    </QueryClientProvider>,
  )
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('WordCard core', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
    })
    vi.mocked(aiApi.translate).mockResolvedValue({ hints: [], model: '', latency_ms: 0 })
    vi.mocked(externalDictionariesApi.list).mockResolvedValue({ visible: [], available: [] })
    // wordCardExpanded lives in the module-level reader store now (not local
    // useState), so it leaks across tests in this file unless reset.
    useReaderStore.setState({ wordCardExpanded: false })
  })

  it('keeps an in-progress translation save in its original language when locale changes during item creation', async () => {
    setUiLanguage('ru')
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null, status: 'new', confidence: null,
      translations: { primary: null, all: [] }, note: null, tags: [],
    })
    let finishCreation!: (value: Awaited<ReturnType<typeof vocabularyApi.createItem>>) => void
    vi.mocked(vocabularyApi.createItem).mockReturnValue(new Promise((resolve) => { finishCreation = resolve }))
    vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
      id: 't1', text: 'каждый', target_language_code: 'ru', is_primary: true, source_type: 'user',
    })
    function LocalizedCard() {
      const { language } = useI18n()
      return <WordCard word={{ kind: 'token', t: 'cada', n: 'cada', i: 0, sentenceText: null }}
        lang="pt" target={language} lessonId="L1" segId={null} onClose={vi.fn()} sentenceText={null} />
    }
    render(<LocalizedCard />, { wrapper })
    const input = await screen.findByPlaceholderText('Введите новый перевод здесь')
    fireEvent.change(input, { target: { value: 'каждый' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(vocabularyApi.createItem).toHaveBeenCalled())
    act(() => { setUiLanguage('en') })
    await screen.findByPlaceholderText('Enter a new translation here')
    await act(async () => { finishCreation({ item_id: 'I1', status: 'tracked', confidence: 1 }) })
    await waitFor(() => expect(vocabularyApi.addTranslation).toHaveBeenCalledWith('token', 'I1', {
      target_language_code: 'ru', translation_text: 'каждый', source_type: 'user',
    }))
  })

  it('creates a tracked/1 item when a translation is typed on a new word', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
    })
    vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
      id: 'T1',
      text: 'каждый',
      target_language_code: 'ru',
      is_primary: true,
      source_type: 'user',
    })

    renderCard()
    const input = await screen.findByPlaceholderText('Введите новый перевод здесь')
    fireEvent.change(input, { target: { value: 'каждый' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'tracked', confidence: 1, text: 'cada' }),
      )
    })
    await waitFor(() => {
      expect(vocabularyApi.addTranslation).toHaveBeenCalledWith(
        'token',
        'I1',
        expect.objectContaining({ translation_text: 'каждый' }),
      )
    })
  })

  it('does not fire status hotkeys while typing in the translation input', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderCard()
    const input = await screen.findByPlaceholderText('Введите новый перевод здесь')
    // wait for the lookup to resolve (footer only renders once `data` is loaded,
    // which is also the gate that guards the status hotkeys)
    await screen.findByRole('button', { name: 'Игнорировать' })

    fireEvent.change(input, { target: { value: 'kill' } })
    fireEvent.keyDown(input, { key: 'k' })
    fireEvent.keyDown(input, { key: 'i' })
    fireEvent.keyDown(input, { key: '1' })

    // mutate() dispatches asynchronously, so give it a tick before asserting
    // it never fired as a side effect of typing.
    await new Promise((r) => setTimeout(r, 50))
    expect(vocabularyApi.createItem).not.toHaveBeenCalled()
    expect(vocabularyApi.patchItem).not.toHaveBeenCalled()
  })

  it('hotkeys are inert while the dictionary settings panel is open', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null, status: 'new', confidence: null,
      translations: { primary: null, all: [] }, note: null, tags: [],
    })
    renderCard()
    await screen.findByRole('button', { name: 'Игнорировать' })
    fireEvent.click(await screen.findByRole('button', { name: /Настроить/ }))
    expect(await screen.findByText('Показываются')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Введите новый перевод здесь')).toBeNull()

    fireEvent.keyDown(window, { key: '2' })
    await new Promise((r) => setTimeout(r, 50))
    expect(vocabularyApi.createItem).not.toHaveBeenCalled()
    expect(vocabularyApi.patchItem).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(await screen.findByPlaceholderText('Введите новый перевод здесь')).toBeInTheDocument()
  })

  it('sets confidence via the footer pill on an existing tracked item', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 0,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.patchItem).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 2,
    })

    renderCard()
    const pill = await screen.findByRole('button', { name: 'Уровень 2' })
    fireEvent.click(pill)
    await waitFor(() => {
      // renderCard() по умолчанию открывает карточку с lessonId='L1' и без
      // segId — провенанс уходит вместе с обновлением статуса (FLQ-21).
      expect(vocabularyApi.patchItem).toHaveBeenCalledWith('token', 'I1', {
        status: 'tracked',
        confidence: 2,
        lesson_id: 'L1',
        segment_id: undefined,
      })
    })
  })

  it('shows a Wiktionary suggestion and saves it as primary on +', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [
        {
          headword: 'cada',
          part_of_speech: 'det',
          senses: [{ sense_index: 0, translation: 'каждый', usage_note: null, examples: [] }],
        },
      ],
      attribution: {
        source: 'Wiktionary',
        license: 'CC BY-SA 4.0',
        url: 'https://kaikki.org/',
      },
    })
    vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
      id: 'T1',
      text: 'каждый',
      target_language_code: 'ru',
      is_primary: true,
      source_type: 'dictionary',
    })

    renderCard()
    const attribution = await screen.findByRole('link', { name: 'Wiktionary' })
    expect(attribution).toHaveAttribute('href', 'https://kaikki.org/')
    expect(screen.getByText('CC BY-SA 4.0')).toBeInTheDocument()
    const add = await screen.findByRole('button', {
      name: 'Добавить перевод из Wiktionary: каждый',
    })
    fireEvent.click(add)
    await waitFor(() => {
      expect(vocabularyApi.addTranslation).toHaveBeenCalledWith(
        'token',
        'I1',
        expect.objectContaining({ translation_text: 'каждый', source_type: 'dictionary' }),
      )
    })
  })

  it('labels a successful AI suggestion visibly and accessibly', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(aiApi.translate).mockResolvedValue({
      hints: [{ text: 'каждый' }],
      model: 'test-model',
      latency_ms: 1,
    })

    renderCard()

    expect(await screen.findByText('AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить AI перевод: каждый' })).toBeInTheDocument()
  })

  describe('suggestion list', () => {
    const newWord = {
      item_id: null,
      status: 'new' as const,
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    }
    function dictWith(...translations: string[]) {
      return {
        entries: [
          {
            headword: 'cada',
            part_of_speech: 'det',
            senses: translations.map((translation, sense_index) => ({
              sense_index,
              translation,
              usage_note: null,
              examples: [],
            })),
          },
        ],
        attribution: { source: 'Wiktionary', license: 'CC BY-SA 4.0', url: 'https://kaikki.org/' },
      }
    }
    function suggestionTexts() {
      return Array.from(
        screen.getByTestId('word-card-suggestions').querySelectorAll('[data-suggestion-text]'),
      ).map((el) => el.textContent)
    }

    it('keeps dictionary suggestions and attribution visible below AI hints when collapsed', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newWord)
      vi.mocked(aiApi.translate).mockResolvedValue({
        hints: [{ text: 'любой' }, { text: 'каждая' }, { text: 'всякий' }],
        model: 'test-model',
        latency_ms: 1,
      })
      vi.mocked(dictionaryApi.lookup).mockResolvedValue(dictWith('каждый', 'по'))

      renderCard()

      await screen.findByText('любой')
      await screen.findByText('каждый')
      expect(suggestionTexts()).toEqual(['любой', 'каждая', 'всякий', 'каждый', 'по'])
      expect(screen.getByRole('link', { name: 'Wiktionary' })).toHaveAttribute(
        'href',
        'https://kaikki.org/',
      )
    })

    it('shows at most 15 suggestions collapsed and all of them expanded', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newWord)
      const many = Array.from({ length: 18 }, (_, i) => `вариант${i + 1}`)
      vi.mocked(dictionaryApi.lookup).mockResolvedValue(dictWith(...many))

      renderCard()

      await screen.findByText('вариант1')
      expect(suggestionTexts()).toHaveLength(15)
      expect(screen.queryByText('вариант16')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))

      expect(await screen.findByText('вариант18')).toBeInTheDocument()
      expect(suggestionTexts()).toHaveLength(18)
    })

    it('merges suggestions with the same text into one row with both sources', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newWord)
      vi.mocked(aiApi.translate).mockResolvedValue({
        hints: [{ text: 'Каждый' }, { text: 'любой' }],
        model: 'test-model',
        latency_ms: 1,
      })
      vi.mocked(dictionaryApi.lookup).mockResolvedValue(dictWith('каждый ', 'по', 'по'))
      vi.mocked(vocabularyApi.createItem).mockResolvedValue({
        item_id: 'I1',
        status: 'tracked',
        confidence: 1,
      })
      vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
        id: 'T1',
        text: 'Каждый',
        target_language_code: 'ru',
        is_primary: true,
        source_type: 'dictionary',
      })

      renderCard()

      await screen.findByText('любой')
      await waitFor(() => expect(suggestionTexts()).toEqual(['Каждый', 'любой', 'по']))
      const merged = screen.getByRole('button', {
        name: 'Добавить перевод из AI · Wiktionary: Каждый',
      })
      // A dictionary match confirms the AI draft, so it is saved as dictionary data.
      fireEvent.click(merged)
      await waitFor(() =>
        expect(vocabularyApi.addTranslation).toHaveBeenCalledWith(
          'token',
          'I1',
          expect.objectContaining({ translation_text: 'Каждый', source_type: 'dictionary' }),
        ),
      )
    })

    it('reserves a placeholder above dictionary suggestions while AI is loading', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newWord)
      let resolveAi!: (v: Awaited<ReturnType<typeof aiApi.translate>>) => void
      vi.mocked(aiApi.translate).mockReturnValue(new Promise((r) => { resolveAi = r }))
      vi.mocked(dictionaryApi.lookup).mockResolvedValue(dictWith('каждый'))

      renderCard()

      await screen.findByText('каждый')
      expect(await screen.findByTestId('word-card-ai-pending')).toBeInTheDocument()

      await act(async () => {
        resolveAi({ hints: [{ text: 'любой' }], model: 'm', latency_ms: 1 })
      })

      expect(await screen.findByText('любой')).toBeInTheDocument()
      expect(screen.queryByTestId('word-card-ai-pending')).not.toBeInTheDocument()
      expect(suggestionTexts()).toEqual(['любой', 'каждый'])
    })
  })

  it('requests AI for known words but not for tracked ones', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'known',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    renderCard()
    await waitFor(() => expect(aiApi.translate).toHaveBeenCalled())

    vi.clearAllMocks()
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [],
      attribution: { source: '', license: '', url: '' },
    })
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I2',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    renderCard()
    await screen.findAllByText('cada')
    await new Promise((r) => setTimeout(r, 50))
    expect(aiApi.translate).not.toHaveBeenCalled()
  })

  it('passes the sentence as AI context when provided', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    renderCard('Cada casa tem uma porta.')
    await waitFor(() => {
      expect(aiApi.translate).toHaveBeenCalledWith(
        expect.objectContaining({ surface_text: 'cada', context_text: 'Cada casa tem uma porta.' }),
      )
    })
  })

  it('hides the AI section but keeps dictionary attribution when AI is disabled', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(aiApi.translate).mockRejectedValue(new ApiError(503, 'disabled'))
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      entries: [
        {
          headword: 'cada',
          part_of_speech: 'det',
          senses: [{ sense_index: 0, translation: 'каждый', usage_note: null, examples: [] }],
        },
      ],
      attribution: {
        source: 'Wiktionary',
        license: 'CC BY-SA 4.0',
        url: 'https://kaikki.org/',
      },
    })
    renderCard()

    expect(await screen.findByRole('link', { name: 'Wiktionary' })).toHaveAttribute(
      'href',
      'https://kaikki.org/',
    )
    expect(screen.getByText('CC BY-SA 4.0')).toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
    expect(screen.queryByText('AI-переводы отключены')).not.toBeInTheDocument()
    expect(screen.queryByText('Не удалось получить AI-перевод')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument()
  })

  it('explains an uninstalled dictionary pair while keeping manual translation available', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(aiApi.translate).mockRejectedValue(new ApiError(503, 'disabled'))
    vi.mocked(dictionaryApi.lookup).mockResolvedValue({
      availability: 'not_installed',
      entries: [],
      attribution: { source: 'Wiktionary', license: 'CC BY-SA 4.0', url: '' },
    })

    renderCard()

    expect(
      await screen.findByText(
        'Словарь для этой языковой пары не установлен. Можно добавить перевод вручную.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Введите новый перевод здесь')).toBeEnabled()
    act(() => setUiLanguage('en'))
    expect(
      await screen.findByText(
        'The dictionary for this language pair is not installed. You can add a translation manually.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter a new translation here')).toBeEnabled()
  })

  it('shows an inline error with retry on a real AI failure', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(aiApi.translate)
      .mockRejectedValueOnce(new ApiError(500, 'boom'))
      .mockResolvedValueOnce({ hints: [{ text: 'каждый' }], model: 'm', latency_ms: 1 })
    renderCard()
    await screen.findByText('Не удалось получить AI-перевод')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByText(/каждый/)
  })

  it('surfaces an inline error and retries on the next blur after a failed save', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ item_id: 'I1', status: 'tracked', confidence: 1 })
    vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
      id: 'T1',
      text: 'каждый',
      target_language_code: 'ru',
      is_primary: true,
      source_type: 'user',
    })

    renderCard()
    const input = await screen.findByPlaceholderText('Введите новый перевод здесь')
    fireEvent.change(input, { target: { value: 'каждый' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledTimes(1)
    })
    await screen.findByText('Не удалось сохранить')
    expect(vocabularyApi.addTranslation).not.toHaveBeenCalled()

    // Retry: the ref was reset on failure, so the next blur re-attempts the save.
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(vocabularyApi.addTranslation).toHaveBeenCalledWith(
        'token',
        'I1',
        expect.objectContaining({ translation_text: 'каждый' }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Не удалось сохранить')).not.toBeInTheDocument()
    })
  })

  it('creates a tracked/1 item when a note is typed on a new word', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
    })
    vi.mocked(vocabularyApi.putNote).mockResolvedValue({ note: 'моя заметка' })

    renderCard()
    const expandBtn = await screen.findByRole('button', { name: 'Развернуть' })
    fireEvent.click(expandBtn)

    // The notes textarea has no accessible name; find it among all textboxes.
    const notes = (await screen.findAllByRole('textbox')).find((el) => el.tagName === 'TEXTAREA')!
    fireEvent.change(notes, { target: { value: 'моя заметка' } })
    fireEvent.blur(notes)

    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'tracked', confidence: 1, text: 'cada' }),
      )
    })
    await waitFor(() => {
      expect(vocabularyApi.putNote).toHaveBeenCalledWith('token', 'I1', 'моя заметка')
    })
  })

  it('renders saved variants as fields and keeps them out of suggestions', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: {
        primary: {
          id: 'T1',
          text: 'первый',
          target_language_code: 'ru',
          is_primary: true,
          source_type: 'user',
        },
        all: [
          {
            id: 'T1',
            text: 'первый',
            target_language_code: 'ru',
            is_primary: true,
            source_type: 'user',
          },
          {
            id: 'T2',
            text: 'второй',
            target_language_code: 'ru',
            is_primary: false,
            source_type: 'user',
          },
        ],
      },
      note: null,
      tags: [],
    })
    renderCard()
    expect(await screen.findByDisplayValue('первый')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('второй')).toBeInTheDocument()
    expect(screen.queryByText('Подсказки')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Добавить перевод .*: первый/ }),
    ).not.toBeInTheDocument()
  })

  it('deletes a variant via its ✕ button', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: {
        primary: {
          id: 'T1',
          text: 'первый',
          target_language_code: 'ru',
          is_primary: true,
          source_type: 'user',
        },
        all: [
          {
            id: 'T1',
            text: 'первый',
            target_language_code: 'ru',
            is_primary: true,
            source_type: 'user',
          },
        ],
      },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.deleteTranslation).mockResolvedValue({ translations: [] })
    renderCard()
    const del = await screen.findByRole('button', { name: 'Удалить вариант: первый' })
    fireEvent.click(del)
    await waitFor(() => {
      expect(vocabularyApi.deleteTranslation).toHaveBeenCalledWith('token', 'I1', 'T1')
    })
  })

  it('shows the ignored layout with a reactivation hint and no editing blocks', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'ignored',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    renderCard()
    await screen.findByText('Игнорируется')
    expect(
      screen.getByText('Выберите уровень 1–4 или ✓, чтобы вернуть слово в изучение'),
    ).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Введите новый перевод здесь')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    // footer stays for reactivation
    expect(screen.getByRole('button', { name: 'Уровень 1' })).toBeInTheDocument()
  })

  it('persists the expanded state across card reopen via the reader store', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    const { unmount } = renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Развернуть' }))
    await screen.findByText('Заметки')
    unmount()
    renderCard()
    expect(await screen.findByText('Заметки')).toBeInTheDocument()
    // restore the default for other tests
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))
  })

  it('renders and omits lesson_id from the AI request when lessonId is null (vocabulary page reuse)', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    renderCard(null, null)

    expect(await screen.findByTestId('word-card')).toBeInTheDocument()
    await waitFor(() => {
      expect(aiApi.translate).toHaveBeenCalled()
    })
    // The request must not carry a real lesson_id value (it's omitted from
    // the wire body via JSON.stringify dropping `undefined`).
    expect(aiApi.translate).not.toHaveBeenCalledWith(
      expect.objectContaining({ lesson_id: expect.anything() }),
    )
  })

  it('передаёт lesson_id и segment_id при добавлении слова', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
    })

    renderCard(null, 'L1', 'S1')
    fireEvent.click(await screen.findByRole('button', { name: 'Уровень 1' }))
    await waitFor(() => {
      expect(vocabularyApi.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ lesson_id: 'L1', segment_id: 'S1' }),
      )
    })
  })

  it('phrase card: no dictionary lookup, creates item with kind=phrase', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    vi.mocked(vocabularyApi.createItem).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
    })

    render(
      <WordCard
        word={{
          kind: 'phrase',
          t: 'so far, so good',
          n: 'so far so good',
          i: 10,
          sentenceText: 'So far, so good it is.',
        }}
        lang="en"
        target="ru"
        lessonId="l1"
        segId="s1"
        onClose={() => {}}
        sentenceText={null}
      />,
      { wrapper },
    )
    expect(await screen.findByText('so far, so good')).toBeInTheDocument()
    expect(dictionaryApi.lookup).not.toHaveBeenCalled()
    // Phrase lookup must send the SURFACE text, not the pre-normalized join
    // key: server-side normalize_phrase is not idempotent, so re-normalizing
    // `word.n` would compute a different key than createItem's surface-based
    // save and the just-saved phrase would look perpetually "new".
    await waitFor(() => {
      expect(vocabularyApi.lookup).toHaveBeenCalledWith('en', 'so far, so good', 'ru', 'phrase')
    })
    // выставляем статус — создание item уходит с kind=phrase
    fireEvent.click(await screen.findByRole('button', { name: 'Уровень 1' }))
    await waitFor(() =>
      // display_text must be the surface selection (with punctuation/casing),
      // not the normalized join key — the backend persists `text` verbatim.
      expect(vocabularyApi.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'phrase', text: 'so far, so good' }),
      ),
    )
  })

  it('token card still queries the dictionary', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: null,
      status: 'new',
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })

    render(
      <WordCard
        // t (surface) and n (normalized) deliberately differ here to prove
        // the token path keeps using the normalized `n`, unlike phrases.
        word={{ kind: 'token', t: 'Far', n: 'far', i: 1, sentenceText: null }}
        lang="en"
        target="ru"
        lessonId="l1"
        segId="s1"
        onClose={() => {}}
        sentenceText="It is far."
      />,
      { wrapper },
    )
    await waitFor(() => expect(dictionaryApi.lookup).toHaveBeenCalled())
    // Token normalization IS idempotent, so token lookups keep sending the
    // normalized join key `n` (not the surface `t`).
    await waitFor(() => {
      expect(vocabularyApi.lookup).toHaveBeenCalledWith('en', 'far', 'ru', 'token')
    })
  })

  it('renders inside a panel without its standalone shell or Escape handler', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    const onClose = vi.fn()

    render(
      <WordCard
        word={{ kind: 'token', t: 'Cada', n: 'cada', i: 0, sentenceText: null }}
        lang="pt"
        target="ru"
        lessonId="L1"
        segId="S1"
        onClose={onClose}
        sentenceText="Cada casa tem uma porta."
        embedded
        closeLabel="К списку"
      />,
      { wrapper },
    )

    expect(await screen.findByText('Cada')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('Введите новый перевод здесь')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Уровень 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'К списку' })).toBeInTheDocument()
    expect(screen.queryByTestId('word-card-backdrop')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not apply status hotkeys while a panel popover is active', async () => {
    vi.mocked(vocabularyApi.lookup).mockResolvedValue({
      item_id: 'I1',
      status: 'tracked',
      confidence: 1,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    })
    const { container } = render(
      <>
        <WordCard
          word={{ kind: 'token', t: 'Cada', n: 'cada', i: 0, sentenceText: null }}
          lang="pt"
          target="ru"
          lessonId="L1"
          segId="S1"
          onClose={() => {}}
          sentenceText="Cada casa tem uma porta."
          embedded
        />
        <div data-reader-panel-popover>Открытый picker</div>
      </>,
      { wrapper },
    )
    await screen.findByRole('button', { name: 'Уровень 1' })

    fireEvent.keyDown(container, { key: '2' })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(vocabularyApi.patchItem).not.toHaveBeenCalled()
  })

  // FLQ-32.2: the touch hint is shown only for a reader word card; CSS hides it
  // on hover-capable (mouse) devices.
  it('shows the long-press phrase hint on a reader word card', () => {
    renderCard()
    expect(screen.getByText('Удерживайте слово и ведите пальцем, чтобы выделить фразу')).toBeInTheDocument()
  })

  it('omits the phrase hint outside the reader and on phrase cards', () => {
    const { unmount } = renderCard(null, null)
    expect(screen.queryByText('Удерживайте слово и ведите пальцем, чтобы выделить фразу')).not.toBeInTheDocument()
    unmount()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <WordCard
          word={{ kind: 'phrase', t: 'cada dia', n: 'cada dia', i: 0, endOrdinal: 1, sentenceText: null }}
          lang="pt"
          target="ru"
          lessonId="L1"
          segId={null}
          onClose={() => {}}
          sentenceText={null}
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByText('Удерживайте слово и ведите пальцем, чтобы выделить фразу')).not.toBeInTheDocument()
  })

  describe('external dictionaries row', () => {
    const newLookup = {
      item_id: null,
      status: 'new' as const,
      confidence: null,
      translations: { primary: null, all: [] },
      note: null,
      tags: [],
    }

    it('shows the row without suggestions or AI', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newLookup)
      renderCard()
      expect(await screen.findByTestId('word-card-dictionaries')).toBeInTheDocument()
      expect(screen.queryByText('Подсказки')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Настроить/ })).toBeInTheDocument()
    })

    it('places the row right after the translation field, before suggestions', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newLookup)
      renderCard()
      const row = await screen.findByTestId('word-card-dictionaries')
      const translation = screen.getByText('Перевод')
      const suggestions = screen.getByTestId('word-card-suggestions')
      expect(translation.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(row.compareDocumentPosition(suggestions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows the dictionaries row for a phrase using its surface text', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newLookup)
      vi.mocked(externalDictionariesApi.list).mockResolvedValue({
        visible: [
          {
            ref: 'reverso',
            kind: 'builtin',
            name: 'Reverso',
            url_template: 'https://context.reverso.net/translation/portuguese-russian/{word}',
            word_encoding: 'default',
            custom_id: null,
            all_languages: false,
          },
        ],
        available: [],
      })
      render(
        <WordCard
          word={{ kind: 'phrase', t: 'de repente', n: 'de repente', i: 0, endOrdinal: 1, sentenceText: null }}
          lang="pt"
          target="ru"
          lessonId="L1"
          segId={null}
          onClose={() => {}}
          sentenceText={null}
        />,
        { wrapper },
      )
      const link = await screen.findByRole('link', { name: /Reverso/ })
      expect(link.getAttribute('href')).toContain('de%20repente')
    })

    it('hides the dictionaries row for ignored words', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue({
        ...newLookup,
        item_id: 'I1',
        status: 'ignored',
      })
      renderCard()
      await screen.findByText('Игнорируется')
      expect(screen.queryByTestId('word-card-dictionaries')).not.toBeInTheDocument()
    })

    it('requests dictionaries for the lang/target props', async () => {
      vi.mocked(vocabularyApi.lookup).mockResolvedValue(newLookup)
      renderCard()
      await waitFor(() => expect(externalDictionariesApi.list).toHaveBeenCalledWith('pt', 'ru'))
    })
  })
})
