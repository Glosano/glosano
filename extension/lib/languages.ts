import { t, type MessageKey } from './i18n'

export const LEARNING_LANGUAGES = ['en', 'ru', 'pt', 'es', 'fr', 'de', 'zh-Hans', 'ja', 'ar', 'hi'] as const
export type LanguageCode = (typeof LEARNING_LANGUAGES)[number]

const LABEL_KEYS: Record<LanguageCode, MessageKey> = {
  en: 'lang_en',
  ru: 'lang_ru',
  pt: 'lang_pt',
  es: 'lang_es',
  fr: 'lang_fr',
  de: 'lang_de',
  'zh-Hans': 'lang_zh_Hans',
  ja: 'lang_ja',
  ar: 'lang_ar',
  hi: 'lang_hi',
}

export function languageLabel(code: string): string {
  const key = LABEL_KEYS[code as LanguageCode]
  return key ? t(key) : code
}

const SIMPLIFIED_CHINESE = new Set(['zh', 'zh-cn', 'zh-sg', 'zh-hans'])

function learningCodeFor(pageLang: string): string | null {
  const lang = pageLang.trim().toLowerCase().replace(/_/g, '-')
  if (!lang) return null
  if (SIMPLIFIED_CHINESE.has(lang) || lang.startsWith('zh-hans-')) return 'zh-Hans'
  if (lang.startsWith('zh')) return null
  return lang.split('-')[0] ?? null
}

export function pickDefaultLanguage(pageLang: string | null, learning: string[], last: string | null): string | null {
  const fromPage = pageLang ? learningCodeFor(pageLang) : null
  if (fromPage && learning.includes(fromPage)) return fromPage
  if (last && learning.includes(last)) return last
  return learning[0] ?? null
}
