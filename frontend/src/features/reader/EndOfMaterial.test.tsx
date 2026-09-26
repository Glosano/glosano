import type { ComponentProps, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  // Real Link forwards unknown attributes to <a>; the mock must too.
  Link: ({
    children,
    to,
    search,
    params,
    ...rest
  }: {
    children?: ReactNode
    to: string
    search?: object
    params?: object
  }) => (
    <a
      href="#"
      {...rest}
      data-to={to}
      data-params={JSON.stringify(params ?? {})}
      data-search={JSON.stringify(search ?? {})}
    >
      {children}
    </a>
  ),
}))

import { EndOfMaterial } from './EndOfMaterial'

function renderEnd(overrides: Partial<ComponentProps<typeof EndOfMaterial>> = {}) {
  const props = {
    lang: 'en',
    lessonId: 'lesson-1',
    completed: false,
    showNewWordsNote: true,
    busy: false,
    error: false,
    onFinish: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
  render(<EndOfMaterial {...props} />)
  return props
}

describe('EndOfMaterial', () => {
  it('offers finishing with the new-words note and focuses the heading, not the finish action', () => {
    const props = renderEnd()
    // Focus must not land on Finish: a repeated or held Enter from the "›" arrow
    // would otherwise complete the material immediately.
    expect(screen.getByRole('heading', { name: 'Вы всё прочитали' })).toHaveFocus()
    expect(
      screen.getByText('Новые слова последней страницы будут отмечены как известные'),
    ).toBeInTheDocument()
    const finish = screen.getByRole('button', { name: 'Завершить материал' })
    expect(finish).not.toHaveFocus()
    fireEvent.click(finish)
    expect(props.onFinish).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к тексту' }))
    expect(props.onBack).toHaveBeenCalledOnce()
  })

  it('omits the note when the last fragment has no new words', () => {
    renderEnd({ showNewWordsNote: false })
    expect(screen.queryByText(/будут отмечены как известные/)).not.toBeInTheDocument()
  })

  it('blocks finishing while busy and shows a retryable error', () => {
    renderEnd({ busy: true, error: true })
    expect(screen.getByRole('button', { name: 'Завершить материал' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось завершить материал. Попробуйте ещё раз.',
    )
  })

  it('shows completed state with library, review and back actions', () => {
    const props = renderEnd({ completed: true })
    expect(screen.getByRole('heading', { name: 'Материал завершён' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Завершить материал' })).not.toBeInTheDocument()
    const library = screen.getByText('В библиотеку').closest('a')
    expect(library).toHaveAttribute('data-to', '/learn/$lang/library')
    expect(screen.getByRole('heading', { name: 'Материал завершён' })).toHaveFocus()
    const review = screen.getByText('Повторить лексику урока').closest('a')
    expect(review).toHaveAttribute('data-to', '/learn/$lang/review')
    expect(review).toHaveAttribute('data-search', JSON.stringify({ lessonId: 'lesson-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к тексту' }))
    expect(props.onBack).toHaveBeenCalledOnce()
  })
})
