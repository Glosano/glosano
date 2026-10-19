import { describe, expect, it } from 'vitest'

import {
  LEARNING_LANGUAGE_CODES,
  TRANSLATION_LANGUAGE_CODES,
  TRANSLATION_LANGUAGES,
  isTranslationLanguageCode,
  languageName,
  learningLanguageFlag,
  learningLanguageLabel,
  translationLanguageFlag,
  translationLanguageLabel,
} from './languages'

/** The documented contract: the Intl.DisplayNames output with an upper-cased first letter. */
function intlName(code: string, locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code)!
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

describe('translation language catalog', () => {
  it('lists the fifteen translation languages in catalog order', () => {
    expect(TRANSLATION_LANGUAGE_CODES).toEqual([
      'en',
      'ru',
      'pt',
      'es',
      'fr',
      'de',
      'zh-Hans',
      'ja',
      'ar',
      'hi',
      'it',
      'ko',
      'tr',
      'pl',
      'uk',
    ])
    expect(TRANSLATION_LANGUAGES.map((item) => item.code)).toEqual(TRANSLATION_LANGUAGE_CODES)
    expect(LEARNING_LANGUAGE_CODES.every((code) => isTranslationLanguageCode(code))).toBe(true)
    expect(isTranslationLanguageCode('nl')).toBe(false)
  })

  it('renders flags and localized labels for the new codes', () => {
    expect(translationLanguageFlag('uk')).toBe('🇺🇦')
    expect(translationLanguageFlag('it')).toBe('🇮🇹')
    expect(translationLanguageFlag('ko')).toBe('🇰🇷')
    expect(translationLanguageFlag('tr')).toBe('🇹🇷')
    expect(translationLanguageFlag('pl')).toBe('🇵🇱')
    expect(translationLanguageFlag('xx')).toBe('🏳')
    expect(translationLanguageLabel('uk', 'ru')).toBe(intlName('uk', 'ru'))
    expect(translationLanguageLabel('ko', 'en')).toBe(intlName('ko', 'en'))
    expect(translationLanguageLabel('pt', 'ru')).toBe(intlName('pt', 'ru'))
    expect(translationLanguageLabel('xx', 'en')).toBe('xx')
  })

  it('lets learning-language helpers show translations into any catalog language', () => {
    expect(learningLanguageFlag('uk')).toBe('🇺🇦')
    expect(learningLanguageLabel('pl', 'en')).toBe(intlName('pl', 'en'))
    expect(learningLanguageFlag('pt')).toBe('🇵🇹')
  })
})

describe('languageName', () => {
  it('follows Intl.DisplayNames with an upper-cased first letter', () => {
    expect(languageName('zh-Hans', 'en')).toBe(intlName('zh-Hans', 'en'))
    expect(languageName('pt', 'ru')).toBe(intlName('pt', 'ru'))
  })
})
