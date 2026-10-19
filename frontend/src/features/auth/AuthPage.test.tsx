import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./AuthLanguagePicker', () => ({ AuthLanguagePicker: () => null }))

import { AuthPage } from './AuthPage'

describe('AuthPage', () => {
  it('shows the Glosano logo above the form', () => {
    render(
      <AuthPage>
        <form aria-label="login" />
      </AuthPage>,
    )

    const logo = screen.getByRole('img', { name: 'Glosano' })
    const form = screen.getByRole('form', { name: 'login' })
    expect(logo.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
