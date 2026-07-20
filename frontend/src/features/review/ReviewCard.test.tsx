import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReviewCard } from './ReviewCard'

const ITEM = {
  review_item_id: 'R1', item_kind: 'token' as const, item_id: 'I1',
  text: 'cada', confidence: 1, translation: 'каждый', notes: 'заметка',
  context_sentence: 'Cada dia é único.',
}

function renderCard(over: Partial<Parameters<typeof ReviewCard>[0]> = {}) {
  const props = {
    item: ITEM, flipped: false, answering: false, error: null,
    onFlip: vi.fn(), onAnswer: vi.fn(),
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

  it('back shows translation, notes and answer buttons', () => {
    const p = renderCard({ flipped: true })
    expect(screen.getByText('каждый')).toBeTruthy()
    expect(screen.getByText('заметка')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '✗ Ошибка' }))
    expect(p.onAnswer).toHaveBeenCalledWith('wrong')
    fireEvent.click(screen.getByRole('button', { name: '✓ Знаю' }))
    expect(p.onAnswer).toHaveBeenCalledWith('correct')
  })

  it('back without translation shows dash', () => {
    renderCard({ flipped: true, item: { ...ITEM, translation: null, notes: null } })
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('answer buttons disabled while answering, error shown', () => {
    const p = renderCard({ flipped: true, answering: true, error: 'Не удалось сохранить ответ' })
    expect(screen.getByText('Не удалось сохранить ответ')).toBeTruthy()
    const btn = screen.getByRole('button', { name: '✓ Знаю' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(p.onAnswer).not.toHaveBeenCalled()
  })
})
