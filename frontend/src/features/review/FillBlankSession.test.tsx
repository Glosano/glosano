import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { FillBlankSession } from './FillBlankSession'
import { reviewApi } from '@/api/review'

vi.mock('@/api/review', () => ({
  reviewApi: { queue: vi.fn(), selectedQueue: vi.fn(), exercise: vi.fn(), answer: vi.fn() },
}))
const item = {
  review_item_id: 'R1',
  item_kind: 'phrase' as const,
  item_id: 'P1',
  text: 'bom dia',
  confidence: 1,
  translation: 'доброе утро',
  translation_language_code: 'ru',
  notes: null,
  context_sentence: null,
}
const daily = { limit: 1, done_today: 1, limit_reached: false }
function show(ids?: string[]) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FillBlankSession lang="pt" ids={ids} />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reviewApi.queue).mockResolvedValue({ items: [item], daily })
  vi.mocked(reviewApi.selectedQueue).mockResolvedValue({ items: [item], daily })
  vi.mocked(reviewApi.exercise).mockResolvedValue({
    payload: {
      before: 'Ela disse ',
      answer: 'bom dia',
      after: ' ao entrar.',
      translation: 'Она сказала «доброе утро», когда вошла.',
    },
    model: 'm',
    latency_ms: 1,
  })
})
it('requires a typed phrase, reveals a hint and checks without touching SRS', async () => {
  show()
  const input = await screen.findByRole('textbox', { name: 'Введите фразу целиком' })
  expect(screen.queryByText('bom dia')).toBeNull()
  expect(screen.queryByText('Она сказала «доброе утро», когда вошла.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Подсказка' }))
  expect(screen.getByText('Она сказала «доброе утро», когда вошла.')).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '  BOM   DIA  ' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.submit(input.closest('form') ?? document.createElement('form'))
  expect(screen.getByText('Верно!')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Дальше' }))
  expect(screen.getByText('Практика завершена')).toBeInTheDocument()
  expect(screen.getByText('Попыток').nextElementSibling).toHaveTextContent('1')
  expect(reviewApi.answer).not.toHaveBeenCalled()
  expect(reviewApi.exercise).toHaveBeenCalledTimes(1)
})
it('uses the selected difficult words and does not substitute a general queue', async () => {
  show(['R1'])
  await screen.findByRole('textbox')
  expect(reviewApi.selectedQueue).toHaveBeenCalledWith('pt', ['R1'], true, undefined, undefined)
  expect(reviewApi.queue).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
  expect(screen.getByText('Пропущено').nextElementSibling).toHaveTextContent('1')
  expect(reviewApi.answer).not.toHaveBeenCalled()
})
it('does not submit an IME composition and allows a neutral mismatch', async () => {
  show()
  const input = await screen.findByRole('textbox')
  fireEvent.change(input, { target: { value: 'boa tarde' } })
  fireEvent.compositionStart(input)
  fireEvent.submit(input.closest('form')!)
  expect(screen.queryByText('В этом задании изучаем другое слово.')).toBeNull()
  fireEvent.compositionEnd(input)
  fireEvent.submit(input.closest('form')!)
  expect(screen.getByText('В этом задании изучаем другое слово.')).toBeInTheDocument()
  expect(screen.getByText('Изучаемая форма: bom dia')).toBeInTheDocument()
  expect(reviewApi.answer).not.toHaveBeenCalled()
})
it('recovers generation failure and finishes without scoring the remainder', async () => {
  vi.mocked(reviewApi.exercise).mockRejectedValueOnce(new Error('offline'))
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  await screen.findByRole('textbox')
  fireEvent.click(screen.getByRole('button', { name: 'Завершить занятие' }))
  await waitFor(() =>
    expect(screen.getByText('Осталось без ответа').nextElementSibling).toHaveTextContent('1'),
  )
  expect(reviewApi.answer).not.toHaveBeenCalled()
})
