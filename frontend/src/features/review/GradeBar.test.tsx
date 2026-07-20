import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GradeBar } from './GradeBar'

describe('GradeBar', () => {
  it('renders six grade buttons and reports clicks', () => {
    const onGrade = vi.fn()
    render(<GradeBar onGrade={onGrade} disabled={false} />)
    const btn5 = screen.getByRole('button', { name: /5.*Идеально/ })
    fireEvent.click(btn5)
    expect(onGrade).toHaveBeenCalledWith(5)
    fireEvent.click(screen.getByRole('button', { name: /0.*Полный провал/ }))
    expect(onGrade).toHaveBeenCalledWith(0)
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('disables all buttons while answering', () => {
    const onGrade = vi.fn()
    render(<GradeBar onGrade={onGrade} disabled />)
    const btn = screen.getByRole('button', { name: /3.*С трудом/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onGrade).not.toHaveBeenCalled()
  })
})
