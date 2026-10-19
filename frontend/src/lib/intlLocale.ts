import type { UiLanguage } from './uiLanguages'

/**
 * The BCP 47 locale Intl uses for a UI language. CLDR's `pt` is Brazilian (0 is singular: «0
 * palavra»); the catalogs are European Portuguese, where 0 takes the plural.
 */
export function intlLocale(language: UiLanguage): string {
  return language === 'pt' ? 'pt-PT' : language
}
