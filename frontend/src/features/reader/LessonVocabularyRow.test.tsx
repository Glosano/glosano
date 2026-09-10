import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { LessonVocabularyItem } from '@/api/reader'

vi.mock('@/api/vocabulary', () => ({ vocabularyApi: { createItem: vi.fn(), patchItem: vi.fn() } }))
import { vocabularyApi } from '@/api/vocabulary'
import { LessonVocabularyRow } from './LessonVocabularyRow'

const item: LessonVocabularyItem = {
  kind: 'token',
  item_id: null,
  text: 'casa',
  display_text: 'Casa',
  status: 'new',
  confidence: null,
  primary_translation: null,
  added_here: false,
  context: { segment_id: 'seg-1', token_ordinal: 0, sentence_text: 'Casa casa.' },
}

function renderRow(value = item) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onActionStart = vi.fn()
  const onActionComplete = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <LessonVocabularyRow
        item={value}
        lessonId="lesson-1"
        lang="pt"
        target="ru"
        onOpen={() => undefined}
        onActionStart={onActionStart}
        onActionComplete={onActionComplete}
      />
    </QueryClientProvider>,
  )
  return { onActionStart, onActionComplete }
}

it('retains a new word and reports a failed write', async () => {
  vi.mocked(vocabularyApi.createItem).mockRejectedValue(new Error('offline'))
  renderRow()
  fireEvent.click(screen.getByRole('button', { name: 'Добавить Casa в изучение' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить'))
  expect(screen.getByRole('button', { name: 'Открыть карточку Casa' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Добавить Casa в изучение' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
})

it('writes phrase surface text with lesson context and reports success', async () => {
  vi.mocked(vocabularyApi.createItem).mockResolvedValue({
    item_id: 'p1',
    status: 'tracked',
    confidence: 1,
  })
  const phrase = { ...item, kind: 'phrase' as const, text: 'casa azul', display_text: 'Casa, azul' }
  const callbacks = renderRow(phrase)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить Casa, azul в изучение' }))
  await waitFor(() =>
    expect(callbacks.onActionComplete).toHaveBeenCalledWith('phrase:casa azul', 'add'),
  )
  expect(vocabularyApi.createItem).toHaveBeenCalledWith({
    kind: 'phrase',
    language_code: 'pt',
    text: 'Casa, azul',
    status: 'tracked',
    confidence: 1,
    lesson_id: 'lesson-1',
    segment_id: 'seg-1',
  })
})

it('shows tracked zero literally and changes it through the shared picker', async () => {
  vi.mocked(vocabularyApi.patchItem).mockResolvedValue({
    item_id: 't1',
    status: 'tracked',
    confidence: 3,
  })
  const callbacks = renderRow({ ...item, item_id: 't1', status: 'tracked', confidence: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'Изменить уровень Casa, текущий 0' }))
  fireEvent.click(screen.getByRole('button', { name: 'Уровень 3' }))
  await waitFor(() =>
    expect(callbacks.onActionComplete).toHaveBeenCalledWith('token:casa', 'confidence'),
  )
  expect(vocabularyApi.patchItem).toHaveBeenCalledWith('token', 't1', {
    status: 'tracked',
    confidence: 3,
    lesson_id: 'lesson-1',
    segment_id: 'seg-1',
  })
})

it('renders known and ignored as accessible indicators instead of direct actions', () => {
  const { rerender } = (() => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <LessonVocabularyRow
          item={{ ...item, item_id: 'k1', status: 'known' }}
          lessonId="lesson-1"
          lang="pt"
          target="ru"
          onOpen={() => undefined}
          onActionStart={() => undefined}
          onActionComplete={() => undefined}
        />
      </QueryClientProvider>,
    )
  })()

  expect(screen.getByRole('img', { name: 'Известно' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Игнорировать Casa/ })).not.toBeInTheDocument()

  rerender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <LessonVocabularyRow
        item={{ ...item, item_id: 'i1', status: 'ignored' }}
        lessonId="lesson-1"
        lang="pt"
        target="ru"
        onOpen={() => undefined}
        onActionStart={() => undefined}
        onActionComplete={() => undefined}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByRole('img', { name: 'Игнорируется' })).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Отметить Casa как известное/ }),
  ).not.toBeInTheDocument()
})
