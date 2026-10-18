import { describe, expect, it } from 'vitest'

import {
  LEARNING_LANGUAGE_CODES,
  TRANSLATION_LANGUAGE_CODES,
  TRANSLATION_LANGUAGES,
  isTranslationLanguageCode,
  learningLanguageFlag,
  learningLanguageLabel,
  translationLanguageFlag,
  translationLanguageLabel,
} from './languages'

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
    expect(translationLanguageLabel('uk', 'ru')).toBe('Украинский')
    expect(translationLanguageLabel('ko', 'en')).toBe('Korean')
    expect(translationLanguageLabel('pt', 'ru')).toBe('Португальский')
  })

  it('lets learning-language helpers show translations into any catalog language', () => {
    expect(learningLanguageFlag('uk')).toBe('🇺🇦')
    expect(learningLanguageLabel('pl', 'en')).toBe('Polish')
    expect(learningLanguageFlag('pt')).toBe('🇵🇹')
  })
})
