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
type SupportedUiLanguage = 'en' | 'ru'

export interface TranslationLanguage {
  code: TranslationLanguageCode
  flag: string
  labels: Record<SupportedUiLanguage, string>
}

export interface LearningLanguage extends TranslationLanguage {
  code: LearningLanguageCode
}

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'en', flag: '🇬🇧', labels: { en: 'English', ru: 'Английский' } },
  { code: 'ru', flag: '🇷🇺', labels: { en: 'Russian', ru: 'Русский' } },
  { code: 'pt', flag: '🇵🇹', labels: { en: 'Portuguese', ru: 'Португальский' } },
  { code: 'es', flag: '🇪🇸', labels: { en: 'Spanish', ru: 'Испанский' } },
  { code: 'fr', flag: '🇫🇷', labels: { en: 'French', ru: 'Французский' } },
  { code: 'de', flag: '🇩🇪', labels: { en: 'German', ru: 'Немецкий' } },
  {
    code: 'zh-Hans',
    flag: '🇨🇳',
    labels: { en: 'Chinese (Simplified)', ru: 'Китайский (упрощённый)' },
  },
  { code: 'ja', flag: '🇯🇵', labels: { en: 'Japanese', ru: 'Японский' } },
  { code: 'ar', flag: '🇸🇦', labels: { en: 'Arabic', ru: 'Арабский' } },
  { code: 'hi', flag: '🇮🇳', labels: { en: 'Hindi', ru: 'Хинди' } },
  { code: 'it', flag: '🇮🇹', labels: { en: 'Italian', ru: 'Итальянский' } },
  { code: 'ko', flag: '🇰🇷', labels: { en: 'Korean', ru: 'Корейский' } },
  { code: 'tr', flag: '🇹🇷', labels: { en: 'Turkish', ru: 'Турецкий' } },
  { code: 'pl', flag: '🇵🇱', labels: { en: 'Polish', ru: 'Польский' } },
  { code: 'uk', flag: '🇺🇦', labels: { en: 'Ukrainian', ru: 'Украинский' } },
]

const translationLanguageByCode = new Map(TRANSLATION_LANGUAGES.map((item) => [item.code, item]))
const learningCodes = new Set<string>(LEARNING_LANGUAGE_CODES)

export const LEARNING_LANGUAGES: readonly LearningLanguage[] = TRANSLATION_LANGUAGES.filter(
  (item): item is LearningLanguage => learningCodes.has(item.code),
)

export function isTranslationLanguageCode(value: string): value is TranslationLanguageCode {
  return translationLanguageByCode.has(value as TranslationLanguageCode)
}

export function translationLanguageLabel(code: string, uiLanguage: SupportedUiLanguage): string {
  return translationLanguageByCode.get(code as TranslationLanguageCode)?.labels[uiLanguage] ?? code
}

export function translationLanguageFlag(code: string): string {
  return translationLanguageByCode.get(code as TranslationLanguageCode)?.flag ?? '🏳'
}

export function isLearningLanguageCode(value: string): value is LearningLanguageCode {
  return learningCodes.has(value)
}

/** Also labels translations, so it understands every translation-catalog code. */
export function learningLanguageLabel(code: string, uiLanguage: SupportedUiLanguage): string {
  return translationLanguageLabel(code, uiLanguage)
}

/** Also flags translations, so it understands every translation-catalog code. */
export function learningLanguageFlag(code: string): string {
  return translationLanguageFlag(code)
}

export function learningContentDirection(code: string): LearningContentDirection {
  return code === 'ar' ? 'rtl' : 'ltr'
}
