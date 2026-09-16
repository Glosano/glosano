import { createRef, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readerApi, type CompleteLessonResult } from '@/api/reader'
import { setUiLanguage } from '@/lib/i18n'
import { CompletionScreen } from './CompletionScreen'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/learn/en/library">{children}</a>,
}))

const result: CompleteLessonResult = {
  action_id: 'action',
  completed_at: '2026-09-13T12:00:00Z',
  created_count: 8,
  summary: {
    total_words: 30,
    unique_words: 20,
    known_words: 5,
    new_words: 8,
    tracked_words: 6,
    ignored_words: 1,
    added_words: 3,
    added_phrases: 2,
    reading_days: 4,
    marked_known_words: 8,
  },
}
const onRead = vi.fn()
const onUndo = vi.fn()
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CompletionScreen
        lessonId="lesson"
        actionId="action"
        lang="en"
        title="A short story"
        busy={false}
        undoError={false}
        statusRef={createRef()}
        onRead={onRead}
        onUndo={onUndo}
      />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  setUiLanguage('ru')
  vi.spyOn(readerApi, 'completionSummary').mockResolvedValue(result)
})
afterEach(() => {
  vi.restoreAllMocks()
  setUiLanguage('ru')
})

it('shows labelled saved counts and navigation without another completion write', async () => {
  show()
  await screen.findByText('Слов в тексте')
  for (const [label, value] of [
    ['Слов в тексте', '30'],
    ['Уникальных слов', '20'],
    ['Известных', '5'],
    ['Новых', '8'],
    ['На изучении', '6'],
    ['Игнорируемых', '1'],
    ['Дней чтения', '4'],
  ] as const) {
    expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value)
  }
  expect(screen.getByText('Слов: 3 · Фраз: 2')).toBeInTheDocument()
  expect(screen.getByText('При завершении отмечено известными: 8')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить чтение' }))
  fireEvent.click(screen.getByRole('button', { name: 'Отменить завершение' }))
  expect(onRead).toHaveBeenCalledOnce()
  expect(onUndo).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: 'В библиотеку' })).toHaveAttribute(
    'href',
    '/learn/en/library',
  )
})

it('keeps completion and actions available when the summary fails, then retries', async () => {
  vi.mocked(readerApi.completionSummary).mockRejectedValueOnce(new Error('network'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Завершение материала сохранено')
  expect(screen.getByRole('button', { name: 'Продолжить чтение' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  await screen.findByText('Слов в тексте')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not invent zero statistics for legacy completions', async () => {
  vi.mocked(readerApi.completionSummary).mockResolvedValue({ ...result, summary: null })
  show()
  await screen.findByText(/Снимок статистики не сохранён/)
  expect(screen.queryByText('Слов в тексте')).not.toBeInTheDocument()
})

it('renders English labels and an accessible completion focus target', async () => {
  setUiLanguage('en')
  show()
  await screen.findByText('Words in the text')
  expect(screen.getByRole('heading', { name: 'Material completed' })).toBeInTheDocument()
  expect(screen.getByText('Words: 3 · Phrases: 2')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
})

it('rejects results belonging to another completion instead of showing mismatched numbers', async () => {
  vi.mocked(readerApi.completionSummary).mockResolvedValue({ ...result, action_id: 'new-action' })
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Завершение изменилось в другой вкладке',
  )
  expect(screen.queryByText('Слов в тексте')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Отменить завершение' })).toBeDisabled()
})
