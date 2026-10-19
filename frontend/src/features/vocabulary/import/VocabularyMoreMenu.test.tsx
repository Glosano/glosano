import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setUiLanguage } from '@/lib/i18n'
import { VocabularyMoreMenu } from './VocabularyMoreMenu'

beforeEach(() => {
  setUiLanguage('en')
})
afterEach(() => {
  act(() => setUiLanguage('ru'))
})

describe('VocabularyMoreMenu', () => {
  it('opens the LingQ import from the ⋯ menu', async () => {
    const onImportLingq = vi.fn()
    render(<VocabularyMoreMenu onImportLingq={onImportLingq} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import from LingQ…' }))

    expect(onImportLingq).toHaveBeenCalledTimes(1)
  })
})
