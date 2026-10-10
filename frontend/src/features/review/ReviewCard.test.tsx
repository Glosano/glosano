import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readerApi } from '@/api/reader'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReviewCard } from './ReviewCard'

const ITEM = {
  review_item_id: 'R1',
  item_kind: 'token' as const,
  item_id: 'I1',
  text: 'cada',
  confidence: 1,
  translation: 'каждый',
  notes: 'заметка',
  context_sentence: 'Cada dia é único.',
}

function renderCard(over: Partial<Parameters<typeof ReviewCard>[0]> = {}) {
  const props = {
    item: ITEM,
    flipped: false,
    error: null,
    onFlip: vi.fn(),
    ...over,
  }
  render(<ReviewCard {...props} />)
  return props
}

describe('ReviewCard', () => {
  it('front shows word and context, no translation', () => {
    renderCard()
    expect(screen.getByText('cada')).toBeTruthy()
    expect(screen.getByText('Cada dia é único.')).toBeTruthy()
    expect(screen.queryByText('каждый')).toBeNull()
    expect(screen.getByRole('button', { name: 'Показать перевод' })).toBeTruthy()
  })

  it('flip button calls onFlip', () => {
    const p = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Показать перевод' }))
    expect(p.onFlip).toHaveBeenCalled()
  })

  it('back shows translation and notes, no answer buttons', () => {
    renderCard({ flipped: true })
    expect(screen.getByText('каждый')).toBeTruthy()
    expect(screen.getByText('заметка')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '✗ Ошибка' })).toBeNull()
    expect(screen.queryByRole('button', { name: '✓ Знаю' })).toBeNull()
  })

  it('back without translation explains the missing value', () => {
    renderCard({ flipped: true, item: { ...ITEM, translation: null, notes: null } })
    expect(screen.getByText('Перевод не сохранён')).toBeTruthy()
  })

  it('shows error on back', () => {
    renderCard({ flipped: true, error: 'Не удалось сохранить ответ' })
    expect(screen.getByText('Не удалось сохранить ответ')).toBeTruthy()
  })
})

it('keeps the original context and loads that segment translation after reveal', async () => {
  const translate = vi
    .spyOn(readerApi, 'segmentTranslation')
    .mockResolvedValue({ text: 'Каждый день уникален.', source: 'ai', model: 'm', stored: true })
  const props = {
    item: { ...ITEM, context_lesson_id: 'L1', context_segment_id: 'S1' },
    flipped: false,
    error: null,
    onFlip: vi.fn(),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <ReviewCard {...props} />
    </QueryClientProvider>,
  )
  expect(translate).not.toHaveBeenCalled()
  rerender(
    <QueryClientProvider client={client}>
      <ReviewCard {...props} flipped />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Каждый день уникален.')).toBeInTheDocument()
  expect(screen.getByText('Cada dia é único.')).toBeInTheDocument()
  expect(translate).toHaveBeenCalledWith('L1', 'S1', 'ru')
  translate.mockRestore()
})
