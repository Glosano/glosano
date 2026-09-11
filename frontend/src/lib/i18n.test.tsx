import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'

import { getUiLanguage, persistUiLanguage, setUiLanguage, translate, useI18n } from './i18n'

afterEach(() => {
  cleanup()
  useUserStore.getState().reset()
  setUiLanguage('ru')
  localStorage.clear()
})

describe('shared localization', () => {
  it('switches mounted UI and interpolates translated messages', () => {
    function Example() {
      const { t } = useI18n()
      return <p>{t('Язык интерфейса')}</p>
    }
    setUiLanguage('ru')
    render(<Example />)
    expect(screen.getByText('Язык интерфейса')).toBeInTheDocument()
    act(() => setUiLanguage('en'))
    expect(screen.getByText('Interface language')).toBeInTheDocument()
    expect(translate('Не менее {{count}} символов', { count: 10 }, 'en')).toBe(
      'At least 10 characters',
    )
    expect(localStorage.getItem('flinq.ui-language')).toBe('en')
  })

  it('uses the authenticated profile language before the browser preference', () => {
    setUiLanguage('ru')
    useUserStore.setState({ user: { ui_language_code: 'en' } as MeResponse })
    expect(getUiLanguage()).toBe('en')
    expect(translate('Настройки')).toBe('Settings')
  })

  it('retains the profile locale when the user signs out', () => {
    setUiLanguage('ru')
    useUserStore.setState({ user: { ui_language_code: 'en' } as MeResponse })
    persistUiLanguage(getUiLanguage())
    useUserStore.getState().reset()
    expect(getUiLanguage()).toBe('en')
    expect(localStorage.getItem('flinq.ui-language')).toBe('en')
  })
})
