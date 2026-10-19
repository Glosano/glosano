import { intlLocale } from './intlLocale'
import type { UiLanguage } from './uiLanguages'

export const LEARNING_LANGUAGE_CODES = [
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
] as const

/** Languages new translations can target (ADR-0030): every learning language plus five more. */
export const TRANSLATION_LANGUAGE_CODES = [
  ...LEARNING_LANGUAGE_CODES,
  'it',
  'ko',
  'tr',
  'pl',
  'uk',
] as const

export type LearningLanguageCode = (typeof LEARNING_LANGUAGE_CODES)[number]
export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGE_CODES)[number]
export type LearningContentDirection = 'ltr' | 'rtl'

export interface TranslationLanguage {
  code: TranslationLanguageCode
  flag: string
}

export interface LearningLanguage extends TranslationLanguage {
  code: LearningLanguageCode
}

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'en', flag: '🇬🇧' },
  { code: 'ru', flag: '🇷🇺' },
  { code: 'pt', flag: '🇵🇹' },
  { code: 'es', flag: '🇪🇸' },
  { code: 'fr', flag: '🇫🇷' },
  { code: 'de', flag: '🇩🇪' },
  { code: 'zh-Hans', flag: '🇨🇳' },
  { code: 'ja', flag: '🇯🇵' },
  { code: 'ar', flag: '🇸🇦' },
  { code: 'hi', flag: '🇮🇳' },
  { code: 'it', flag: '🇮🇹' },
  { code: 'ko', flag: '🇰🇷' },
  { code: 'tr', flag: '🇹🇷' },
  { code: 'pl', flag: '🇵🇱' },
  { code: 'uk', flag: '🇺🇦' },
]

const translationLanguageByCode = new Map(TRANSLATION_LANGUAGES.map((item) => [item.code, item]))
const learningCodes = new Set<string>(LEARNING_LANGUAGE_CODES)

export const LEARNING_LANGUAGES: readonly LearningLanguage[] = TRANSLATION_LANGUAGES.filter(
  (item): item is LearningLanguage => learningCodes.has(item.code),
)

export function isTranslationLanguageCode(value: string): value is TranslationLanguageCode {
  return translationLanguageByCode.has(value as TranslationLanguageCode)
}

const displayNames = new Map<UiLanguage, Intl.DisplayNames>()

/** Name of a language in the interface language, first letter capitalised; the code if unknown. */
export function languageName(code: string, uiLanguage: UiLanguage): string {
  let names = displayNames.get(uiLanguage)
  if (!names)
    displayNames.set(
      uiLanguage,
      (names = new Intl.DisplayNames([intlLocale(uiLanguage)], {
        type: 'language',
        fallback: 'none',
      })),
    )
  let name: string | undefined
  try {
    name = names.of(code)
  } catch {
    name = undefined
  }
  if (!name) return code
  return name.charAt(0).toLocaleUpperCase(intlLocale(uiLanguage)) + name.slice(1)
}

export function translationLanguageLabel(code: string, uiLanguage: UiLanguage): string {
  return languageName(code, uiLanguage)
}

export function translationLanguageFlag(code: string): string {
  return translationLanguageByCode.get(code as TranslationLanguageCode)?.flag ?? '🏳'
}

export function isLearningLanguageCode(value: string): value is LearningLanguageCode {
  return learningCodes.has(value)
}

/** Also labels translations, so it understands every translation-catalog code. */
export function learningLanguageLabel(code: string, uiLanguage: UiLanguage): string {
  return translationLanguageLabel(code, uiLanguage)
}

/** Also flags translations, so it understands every translation-catalog code. */
export function learningLanguageFlag(code: string): string {
  return translationLanguageFlag(code)
}

export function learningContentDirection(code: string): LearningContentDirection {
  return code === 'ar' ? 'rtl' : 'ltr'
}
