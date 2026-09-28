import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setUiLanguage } from '@/lib/i18n'
import { VideoAdvanceMenu } from './VideoAdvanceMenu'

beforeEach(() => setUiLanguage('ru'))
afterEach(() => {
  cleanup()
  setUiLanguage('ru')
})

it('names the current mode on the trigger and changes it from the menu', async () => {
  const onChange = vi.fn()
  render(<VideoAdvanceMenu mode="page" value="stop" onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'Режим листания: Стоп' }))
  expect(screen.getByRole('menuitemradio', { name: 'Стоп' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(screen.queryByText(/становятся известными/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Листать автоматически' }))
  expect(onChange).toHaveBeenCalledWith('auto')
})

it.each([
  ['page', 'Новые слова покинутой страницы становятся известными. Действие можно отменить.'],
  ['sentence', 'Новые слова покинутого фрагмента становятся известными. Действие можно отменить.'],
] as const)('explains auto advance in %s mode', async (mode, note) => {
  render(<VideoAdvanceMenu mode={mode} value="auto" onChange={() => {}} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Режим листания: Листать автоматически' }),
  )
  expect(screen.getByText(note)).toBeInTheDocument()
})

it('cannot be opened while disabled', () => {
  render(<VideoAdvanceMenu mode="page" value="play" disabled onChange={() => {}} />)
  expect(screen.getByRole('button', { name: 'Режим листания: Играть при листании' })).toBeDisabled()
})

it('cannot change the mode from a menu that was already open when it got locked', async () => {
  const onChange = vi.fn()
  const view = render(<VideoAdvanceMenu mode="page" value="play" onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: 'Режим листания: Играть при листании' }))
  view.rerender(<VideoAdvanceMenu mode="page" value="play" disabled onChange={onChange} />)
  const item = screen.getByRole('menuitemradio', { name: 'Листать автоматически' })
  expect(item).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(item)
  expect(onChange).not.toHaveBeenCalled()
})

it('translates the trigger', () => {
  setUiLanguage('en')
  render(<VideoAdvanceMenu mode="page" value="play" onChange={() => {}} />)
  expect(screen.getByRole('button', { name: 'Page turning: Play on turn' })).toBeInTheDocument()
})
