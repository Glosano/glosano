import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import { ForeignLanguageFlag } from './ForeignLanguageFlag'
import { languageName } from '@/lib/languages'

const langRu = (code: string) => languageName(code, 'ru')

afterEach(() => {
  useUserStore.getState().reset()
})

function setNative(native: MeResponse['native_language_code']) {
  useUserStore.setState({
    user: { ui_language_code: 'ru', native_language_code: native } as MeResponse,
  })
}

describe('ForeignLanguageFlag', () => {
  it('renders nothing for a translation in the native language', () => {
    setNative('ru')
    const { container } = render(<ForeignLanguageFlag code="ru" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('flags a translation left over from another native language', () => {
    setNative('uk')
    render(<ForeignLanguageFlag code="ru" />)
    expect(screen.getByText('🇷🇺')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText(langRu('ru'))).toHaveClass('sr-only')
  })

  it('renders nothing without a language', () => {
    setNative('uk')
    const { container } = render(<ForeignLanguageFlag code={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
