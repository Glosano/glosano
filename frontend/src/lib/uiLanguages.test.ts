import { describe, expect, it } from 'vitest'

import {
  UI_LANGUAGE_CODES,
  detectBrowserLanguage,
  isUiLanguage,
  matchUiLanguage,
  uiLanguageEndonym,
} from './uiLanguages'

describe('isUiLanguage', () => {
  it('accepts supported interface languages', () => {
    for (const code of UI_LANGUAGE_CODES) expect(isUiLanguage(code)).toBe(true)
    expect(isUiLanguage('ru')).toBe(true)
    expect(isUiLanguage('zh-Hans')).toBe(true)
  })

  it('enables exactly the nine interface languages, in order', () => {
    expect([...UI_LANGUAGE_CODES]).toEqual([
      'en',
      'ru',
      'pt',
      'es',
      'fr',
      'de',
      'zh-Hans',
      'ja',
      'hi',
    ])
  })

  it('rejects unsupported values', () => {
    expect(isUiLanguage('ar')).toBe(false)
    expect(isUiLanguage('xx')).toBe(false)
    expect(isUiLanguage(undefined)).toBe(false)
    expect(isUiLanguage(null)).toBe(false)
  })
})

describe('matchUiLanguage', () => {
  it.each([
    ['pt-BR', 'pt'],
    ['es-MX', 'es'],
    ['de-AT', 'de'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['zh-TW', null],
    ['zh-HK', null],
    ['zh-Hant', null],
    ['ar', null],
    ['ja-JP', 'ja'],
    ['hi-IN', 'hi'],
  ])('maps %s to %s', (tag, expected) => {
    expect(matchUiLanguage(tag)).toBe(expected)
  })
})

describe('detectBrowserLanguage', () => {
  it.each([
    [['ru-RU'], 'ru'],
    [['en-GB'], 'en'],
    [['zh-TW', 'ar', 'ru'], 'ru'],
    [['pt-BR'], 'pt'],
    [['zh-TW', 'ar', 'de-DE'], 'de'],
    [['zh-CN'], 'zh-Hans'],
    [['ar-EG'], 'en'],
    [[], 'en'],
  ] as const)('picks the first supported language of %j: %s', (preferred, expected) => {
    expect(detectBrowserLanguage(preferred)).toBe(expected)
  })
})

describe('uiLanguageEndonym', () => {
  it('names each language in itself', () => {
    expect(uiLanguageEndonym('en')).toBe('English')
    expect(uiLanguageEndonym('ru')).toBe('Русский')
    expect(uiLanguageEndonym('ja')).toBe('日本語')
  })
})
