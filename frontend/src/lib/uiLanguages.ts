import { languageName } from './languages'

export const UI_LANGUAGE_CODES = [
  'en',
  'ru',
  'pt',
  'es',
  'fr',
  'de',
  'zh-Hans',
  'ja',
  'hi',
] as const

export type UiLanguage = (typeof UI_LANGUAGE_CODES)[number]

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (UI_LANGUAGE_CODES as readonly string[]).includes(value)
}

const TRADITIONAL_CHINESE_REGIONS = new Set(['TW', 'HK', 'MO'])

/**
 * Maps a BCP 47 tag to an interface language code.
 * Only Simplified Chinese is offered, so Traditional-script and TW/HK/MO tags have no match.
 */
export function matchUiLanguage(tag: string): string | null {
  const [primary = '', ...rest] = tag.split(/[-_]/)
  const language = primary.toLowerCase()
  if (language === 'zh') {
    const script = rest.find((part) => /^[A-Za-z]{4}$/.test(part))?.toLowerCase()
    if (script) return script === 'hans' ? 'zh-Hans' : null
    const region = rest.find((part) => /^([A-Za-z]{2}|\d{3})$/.test(part))?.toUpperCase()
    return region && TRADITIONAL_CHINESE_REGIONS.has(region) ? null : 'zh-Hans'
  }
  return isUiLanguage(language) ? language : null
}

/** First preferred browser language that has an enabled interface; English otherwise. */
export function detectBrowserLanguage(preferred: readonly string[]): UiLanguage {
  for (const tag of preferred) {
    const match = matchUiLanguage(tag)
    if (isUiLanguage(match)) return match
  }
  return 'en'
}

/** A language written in itself, e.g. «Русский» — what a language picker shows. */
export function uiLanguageEndonym(code: UiLanguage): string {
  return languageName(code, code)
}
