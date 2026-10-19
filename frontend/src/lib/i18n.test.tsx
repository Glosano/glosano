import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'

import {
  __resetCatalogsForTests,
  __setCatalogLoaderForTests,
  type Catalog,
  ctx,
  getUiLanguage,
  initI18n,
  loadCatalog,
  msg,
  persistUiLanguage,
  registerCatalog,
  setUiLanguage,
  translate,
  useI18n,
} from './i18n'
import { UI_LANGUAGE_CODES } from './uiLanguages'

afterEach(async () => {
  cleanup()
  useUserStore.getState().reset()
  __resetCatalogsForTests()
  await Promise.all(UI_LANGUAGE_CODES.map(loadCatalog))
  await setUiLanguage('ru')
  localStorage.clear()
})

describe('shared localization', () => {
  it('switches mounted UI and interpolates translated messages', () => {
    function Example() {
      const { t } = useI18n()
      return <p>{t('Interface language')}</p>
    }
    render(<Example />)
    expect(screen.getByText('Язык интерфейса')).toBeInTheDocument()
    act(() => {
      void setUiLanguage('en')
    })
    expect(screen.getByText('Interface language')).toBeInTheDocument()
    expect(translate('Remove tag: {{value0}}', { value0: 'news' }, 'ru')).toBe('Удалить тег: news')
    expect(localStorage.getItem('glosano.ui-language')).toBe('en')
  })

  it('uses the authenticated profile language before the browser preference', () => {
    useUserStore.setState({ user: { ui_language_code: 'en' } as MeResponse })
    expect(getUiLanguage()).toBe('en')
    expect(translate('Settings')).toBe('Settings')
  })

  it('retains the profile locale when the user signs out', () => {
    useUserStore.setState({ user: { ui_language_code: 'en' } as MeResponse })
    persistUiLanguage(getUiLanguage())
    useUserStore.getState().reset()
    expect(getUiLanguage()).toBe('en')
    expect(localStorage.getItem('glosano.ui-language')).toBe('en')
  })

  it('switches mounted UI when the profile language changes', () => {
    registerCatalog('ru', { Settings: 'Настройки' })
    function Example() {
      const { t } = useI18n()
      return <p>{t('Settings')}</p>
    }
    render(<Example />)
    expect(screen.getByText('Настройки')).toBeInTheDocument()
    act(() => {
      useUserStore
        .getState()
        .setUser({ ui_language_code: 'en', learning_languages: [] } as unknown as MeResponse)
    })
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(getUiLanguage()).toBe('en')
  })
})

describe('plural forms', () => {
  it('selects Russian plural forms for 1, 3, 5, 21, 22, 111', () => {
    registerCatalog('ru', {
      '{{count}} words': {
        one: '{{count}} слово',
        few: '{{count}} слова',
        many: '{{count}} слов',
        other: '{{count}} слова',
      },
    })
    const forms: [number, string][] = [
      [1, '1 слово'],
      [3, '3 слова'],
      [5, '5 слов'],
      [21, '21 слово'],
      [22, '22 слова'],
      [111, '111 слов'],
    ]
    for (const [count, expected] of forms) {
      expect(translate('{{count}} words', { count }, 'ru')).toBe(expected)
    }
  })

  it('uses English plural forms for English', () => {
    registerCatalog('en', {
      '{{count}} words': { one: '{{count}} word', other: '{{count}} words' },
    })
    expect(translate('{{count}} words', { count: 1 }, 'en')).toBe('1 word')
    expect(translate('{{count}} words', { count: 2 }, 'en')).toBe('2 words')
  })

  it('formats a numeric count with the UI locale but leaves other numbers alone', () => {
    registerCatalog('ru', {
      '{{count}} words': {
        one: '{{count}} слово',
        few: '{{count}} слова',
        many: '{{count}} слов',
        other: '{{count}} слова',
      },
    })
    registerCatalog('en', {
      '{{count}} words': { one: '{{count}} word', other: '{{count}} words' },
    })
    const russian = translate('{{count}} words', { count: 1000 }, 'ru')
    expect(russian).toBe(`${new Intl.NumberFormat('ru').format(1000)} слов`)
    expect(russian).not.toBe('1000 слов')
    expect(translate('{{count}} words', { count: 1000 }, 'en')).toBe('1,000 words')
    expect(translate('Page {{page}} of {{total}}', { page: 1000, total: 2000 }, 'ru')).toBe(
      'Page 1000 of 2000',
    )
  })

  it('uses European Portuguese plural rules, so zero takes the plural form', () => {
    expect(translate('{{count}} words', { count: 0 }, 'pt')).toBe('0 palavras')
    expect(translate('{{count}} words', { count: 1 }, 'pt')).toBe('1 palavra')
    expect(translate('{{count}} words', { count: 2 }, 'pt')).toBe('2 palavras')
  })

  it('falls back to the other form when the selected form is missing', () => {
    registerCatalog('ru', { '{{count}} cards': { other: '{{count}} карт' } })
    expect(translate('{{count}} cards', { count: 1 }, 'ru')).toBe('1 карт')
  })

  it('takes plural forms of an English fallback from the English rules', () => {
    registerCatalog('en', {
      '{{count}} cards': { one: '{{count}} card', other: '{{count}} cards' },
    })
    expect(translate('{{count}} cards', { count: 1 }, 'ru')).toBe('1 card')
  })
})

describe('enabled interface languages', () => {
  it('switches to a lazily loaded language and renders its catalog', async () => {
    __resetCatalogsForTests()
    await setUiLanguage('ja')
    expect(getUiLanguage()).toBe('ja')
    const japanese = await import('./locales/ja/common')
    const catalog = Object.values(japanese)[0] as Catalog
    expect(catalog['Settings']).toBeDefined()
    expect(translate('Settings')).toBe(catalog['Settings'])
    expect(translate('Settings')).not.toBe('Settings')
  })
})

describe('lookup order', () => {
  it('falls back from context to plain key to English to the key itself', () => {
    registerCatalog('ru', { [ctx('filter', 'Known')]: 'Изученные', Known: 'Известно' })
    registerCatalog('en', { OnlyEnglish: 'Only English' })
    expect(translate('Known', { context: 'filter' }, 'ru')).toBe('Изученные')
    expect(translate('Known', { context: 'other' }, 'ru')).toBe('Известно')
    expect(translate('OnlyEnglish', undefined, 'ru')).toBe('Only English')
    expect(translate('Unseen', undefined, 'ru')).toBe('Unseen')
  })

  it('never interpolates the context param', () => {
    registerCatalog('ru', { 'Say {{context}}': 'Скажи {{context}}' })
    expect(translate('Say {{context}}', { context: 'filter' }, 'ru')).toBe('Скажи {{context}}')
  })

  it('interpolates params into an English message', () => {
    expect(translate('Remove tag: {{value0}}', { value0: 'news' }, 'en')).toBe('Remove tag: news')
  })

  it('interpolates params into the untranslated key', () => {
    expect(translate('Hello {{name}}', { name: 'Ann' }, 'ru')).toBe('Hello Ann')
  })
})

describe('lazy catalogs', () => {
  function deferredLoader() {
    let resolve!: (catalog: Catalog) => void
    let reject!: (error: Error) => void
    const promise = new Promise<Record<string, Catalog>[]>((res, rej) => {
      resolve = (catalog) => res([{ default: catalog }])
      reject = rej
    })
    __setCatalogLoaderForTests(() => promise)
    return { resolve, reject }
  }

  function Example() {
    const { t } = useI18n()
    return <p>{t('Settings')}</p>
  }

  it('activates a lazily loaded catalog without an intermediate render', async () => {
    await setUiLanguage('en')
    __resetCatalogsForTests()
    const load = deferredLoader()
    const seen: string[] = []
    function Recorder() {
      const { t } = useI18n()
      const text = t('Settings')
      seen.push(text)
      return <p>{text}</p>
    }
    render(<Recorder />)

    let switched!: Promise<void>
    act(() => {
      switched = Promise.resolve(setUiLanguage('ru'))
    })
    // The load is still pending: the UI, the stored choice and the language stay as they were.
    await act(async () => {
      await Promise.resolve()
    })
    expect(getUiLanguage()).toBe('en')
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(localStorage.getItem('glosano.ui-language')).toBe('en')

    load.resolve({ Settings: 'Настройки' })
    await act(async () => {
      await switched
    })
    expect(getUiLanguage()).toBe('ru')
    expect(screen.getByText('Настройки')).toBeInTheDocument()
    expect(seen).toEqual(['Settings', 'Настройки'])
  })

  it('keeps the previous language and the profile language when the load fails', async () => {
    await setUiLanguage('en')
    __resetCatalogsForTests()
    const load = deferredLoader()
    useUserStore.setState({ user: { ui_language_code: 'en' } as MeResponse })
    render(<Example />)

    const switched = Promise.resolve(setUiLanguage('ru'))
    const failure = expect(switched).rejects.toThrow('chunk gone')
    load.reject(new Error('chunk gone'))
    await failure

    expect(getUiLanguage()).toBe('en')
    expect(useUserStore.getState().user?.ui_language_code).toBe('en')
    expect(localStorage.getItem('glosano.ui-language')).toBe('en')
    expect(screen.getByText('Settings')).toBeInTheDocument()

    // The failure is not cached: a later attempt loads again.
    __setCatalogLoaderForTests(() => Promise.resolve([{ default: { Settings: 'Настройки' } }]))
    await act(async () => {
      await setUiLanguage('ru')
    })
    expect(getUiLanguage()).toBe('ru')
    expect(useUserStore.getState().user?.ui_language_code).toBe('ru')
    expect(screen.getByText('Настройки')).toBeInTheDocument()
  })

  it('falls back to English when the boot catalog fails, and retries on a later choice', async () => {
    await setUiLanguage('ru')
    __resetCatalogsForTests()
    await loadCatalog('en')
    __setCatalogLoaderForTests(() => Promise.reject(new Error('chunk gone')))
    render(<Example />)
    expect(getUiLanguage()).toBe('ru')

    await act(async () => {
      await expect(initI18n()).rejects.toThrow('chunk gone')
    })
    expect(getUiLanguage()).toBe('en')
    expect(screen.getByText('Settings')).toBeInTheDocument()
    // The fallback is not the user's explicit choice.
    expect(localStorage.getItem('glosano.ui-language')).toBe('ru')

    // The profile later says Russian: that is a real switch now, and it loads the catalog again.
    __setCatalogLoaderForTests(() => Promise.resolve([{ default: { Settings: 'Настройки' } }]))
    await act(async () => {
      useUserStore
        .getState()
        .setUser({ ui_language_code: 'ru', learning_languages: [] } as unknown as MeResponse)
    })
    await vi.waitFor(() => expect(getUiLanguage()).toBe('ru'))
    expect(screen.getByText('Настройки')).toBeInTheDocument()
  })

  it('logs instead of leaving a rejection unhandled when a profile switch fails', async () => {
    await setUiLanguage('en')
    __resetCatalogsForTests()
    __setCatalogLoaderForTests(() => Promise.reject(new Error('offline')))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      act(() => {
        useUserStore
          .getState()
          .setUser({ ui_language_code: 'ru', learning_languages: [] } as unknown as MeResponse)
      })
      await vi.waitFor(() => expect(logged).toHaveBeenCalled())
      expect(getUiLanguage()).toBe('en')
    } finally {
      logged.mockRestore()
    }
  })

  it('keeps the latest choice when an earlier catalog finishes later', async () => {
    __resetCatalogsForTests()
    await loadCatalog('en')
    const load = deferredLoader()
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = Promise.resolve(setUiLanguage('ru'))
      second = Promise.resolve(setUiLanguage('en'))
    })
    load.resolve({})
    await act(async () => {
      await Promise.all([first, second])
    })
    expect(getUiLanguage()).toBe('en')
  })
})

describe('msg', () => {
  it('returns its argument', () => {
    expect(msg('Settings')).toBe('Settings')
  })
})
