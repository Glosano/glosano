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

export type LearningLanguageCode = (typeof LEARNING_LANGUAGE_CODES)[number]
export type LearningContentDirection = 'ltr' | 'rtl'
type SupportedUiLanguage = 'en' | 'ru'

export interface LearningLanguage {
  code: LearningLanguageCode
  flag: string
  labels: Record<SupportedUiLanguage, string>
}

export const LEARNING_LANGUAGES: readonly LearningLanguage[] = [
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
]

const languageByCode = new Map(LEARNING_LANGUAGES.map((item) => [item.code, item]))

export function isLearningLanguageCode(value: string): value is LearningLanguageCode {
  return languageByCode.has(value as LearningLanguageCode)
}

export function learningLanguageLabel(code: string, uiLanguage: SupportedUiLanguage): string {
  return languageByCode.get(code as LearningLanguageCode)?.labels[uiLanguage] ?? code
}

export function learningLanguageFlag(code: string): string {
  return languageByCode.get(code as LearningLanguageCode)?.flag ?? '🏳'
}

export function learningContentDirection(code: string): LearningContentDirection {
  return code === 'ar' ? 'rtl' : 'ltr'
}
