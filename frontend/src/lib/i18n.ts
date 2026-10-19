import { useCallback } from 'react'
import { create } from 'zustand'

import { useUserStore } from '@/stores/userStore'

import { intlLocale } from './intlLocale'
import { detectBrowserLanguage, isUiLanguage, type UiLanguage } from './uiLanguages'

export { intlLocale } from './intlLocale'
export type { UiLanguage } from './uiLanguages'

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
export type Message = string | PluralForms
export type Catalog = Record<string, Message>
// `count` selects the plural form and is interpolated; `context` only disambiguates the key.
export type TranslationParams = Record<string, string | number> & { context?: string }
export type Translator = (key: string, params?: TranslationParams) => string

const STORAGE_KEY = 'glosano.ui-language'
const CONTEXT_SEPARATOR = '\u0004'

/** Catalog key for a string that needs a context, e.g. `[ctx('filter', 'Known')]: '…'`. */
export function ctx(context: string, key: string): string {
  return `${context}${CONTEXT_SEPARATOR}${key}`
}

/** Identity marker for keys that reach `t()` indirectly, so extraction can find them. */
export function msg<const K extends string>(key: K): K {
  return key
}

type CatalogModule = Record<string, Catalog>
const englishModules = import.meta.glob<CatalogModule>('./locales/en/*.ts', { eager: true })
const lazyModules = import.meta.glob<CatalogModule>(['./locales/*/*.ts', '!./locales/en/*.ts'])

type CatalogLoader = (language: UiLanguage) => Promise<CatalogModule[]>
const importLanguageModules: CatalogLoader = (language) => {
  const prefix = `./locales/${language}/`
  return Promise.all(
    Object.entries(lazyModules)
      .filter(([path]) => path.startsWith(prefix))
      .map(([, load]) => load()),
  )
}
let catalogLoader: CatalogLoader = importLanguageModules

const catalogs: Partial<Record<UiLanguage, Catalog>> = {}
const loaded = new Set<UiLanguage>()
const loading = new Map<UiLanguage, Promise<void>>()

export function registerCatalog(language: UiLanguage, catalog: Catalog): void {
  catalogs[language] = { ...catalogs[language], ...catalog }
}

function registerModules(language: UiLanguage, modules: CatalogModule[]): void {
  for (const module of modules) {
    for (const catalog of Object.values(module)) registerCatalog(language, catalog)
  }
}

export function loadCatalog(language: UiLanguage): Promise<void> {
  if (loaded.has(language)) return Promise.resolve()
  if (language === 'en') {
    registerModules('en', Object.values(englishModules))
    loaded.add('en')
    return Promise.resolve()
  }
  let pending = loading.get(language)
  if (!pending) {
    // A failed import rejects cleanly and is dropped from `loading`, so the next call retries.
    pending = catalogLoader(language)
      .then((modules) => {
        registerModules(language, modules)
        loaded.add(language)
      })
      .finally(() => loading.delete(language))
    loading.set(language, pending)
  }
  return pending
}

/** Test-only: replaces how non-English catalogs are fetched, so a test controls the load. */
export function __setCatalogLoaderForTests(loader: CatalogLoader): void {
  catalogLoader = loader
}

/** Test-only: forgets every catalog and restores the real loader. */
export function __resetCatalogsForTests(): void {
  catalogLoader = importLanguageModules
  for (const language of Object.keys(catalogs) as UiLanguage[]) delete catalogs[language]
  loaded.clear()
  loading.clear()
}

void loadCatalog('en')

function storedLanguage(): UiLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isUiLanguage(stored)) return stored
  } catch {
    /* Storage can be unavailable; fall through to the browser's preference. */
  }
  return detectBrowserLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)
}

const useLocaleStore = create<{ language: UiLanguage }>(() => ({ language: storedLanguage() }))

export function getUiLanguage(): UiLanguage {
  return useLocaleStore.getState().language
}

export function persistUiLanguage(language: UiLanguage): void {
  if (useLocaleStore.getState().language !== language) useLocaleStore.setState({ language })
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* Private browsing may disable storage. */
  }
}

let requestedLanguage: UiLanguage | null = null

function applyLanguage(language: UiLanguage): void {
  persistUiLanguage(language)
  const user = useUserStore.getState().user
  if (user && user.ui_language_code !== language) {
    useUserStore.setState({ user: { ...user, ui_language_code: language } })
  }
}

/**
 * Switches the interface language. When the catalog is already loaded the switch is synchronous
 * and nothing is returned (so `act(() => setUiLanguage('en'))` is not mistaken for an async act);
 * otherwise the returned promise resolves once the catalog is in and the language is active.
 * If the catalog fails to load, the promise rejects and the language, the stored choice and the
 * profile copy all stay as they were.
 */
export function setUiLanguage(language: UiLanguage): Promise<void> | void {
  requestedLanguage = language
  if (loaded.has(language)) {
    applyLanguage(language)
    return
  }
  // The language only switches once its catalog is in, so no English strings flash in between.
  return loadCatalog(language).then(() => {
    // A newer choice made while this catalog loaded wins.
    if (requestedLanguage === language) applyLanguage(language)
  })
}

/** For fire-and-forget callers: a failed catalog load is logged, not left unhandled. */
export function setUiLanguageSafely(language: UiLanguage): void {
  void Promise.resolve(setUiLanguage(language)).catch((error: unknown) => {
    console.error(`Failed to load the "${language}" interface catalog`, error)
  })
}

/**
 * Loads the catalog of the initial language. If that fails the app still renders, in English, so
 * the active language falls back to English too: text, `<html lang>` and the store stay in step,
 * and a later choice of the original language (e.g. from the profile) is a real switch that
 * retries the load. The fallback is not persisted, so the user's stored choice survives.
 */
export function initI18n(): Promise<void> {
  return loadCatalog(getUiLanguage()).catch((error: unknown) => {
    useLocaleStore.setState({ language: 'en' })
    throw error
  })
}

useUserStore.subscribe((state) => {
  const code = state.user?.ui_language_code
  if (isUiLanguage(code) && code !== getUiLanguage()) setUiLanguageSafely(code)
})

const pluralRulesCache = new Map<UiLanguage, Intl.PluralRules>()
const numberFormatCache = new Map<UiLanguage, Intl.NumberFormat>()

function pluralRules(language: UiLanguage): Intl.PluralRules {
  let rules = pluralRulesCache.get(language)
  if (!rules) pluralRulesCache.set(language, (rules = new Intl.PluralRules(intlLocale(language))))
  return rules
}

function numberFormat(language: UiLanguage): Intl.NumberFormat {
  let format = numberFormatCache.get(language)
  if (!format)
    numberFormatCache.set(language, (format = new Intl.NumberFormat(intlLocale(language))))
  return format
}

/**
 * Plural selection uses the raw `count`; only its displayed text follows the UI locale. A numeric
 * `count` gets locale grouping (1 000 / 1,000); pass `String(n)` where plain digits must stay.
 */
function interpolated(
  name: string,
  value: string | number | undefined,
  language: UiLanguage,
): string | undefined {
  if (name === 'count' && typeof value === 'number') return numberFormat(language).format(value)
  return value === undefined ? undefined : String(value)
}

function resolve(
  message: Message,
  language: UiLanguage,
  params: TranslationParams | undefined,
): string {
  if (typeof message === 'string') return message
  const form = pluralRules(language).select(Number(params?.count))
  return message[form] ?? message.other
}

function lookup(
  key: string,
  context: string | undefined,
  language: UiLanguage,
  params: TranslationParams | undefined,
): string | undefined {
  const catalog = catalogs[language]
  if (!catalog) return undefined
  const message = (context !== undefined ? catalog[ctx(context, key)] : undefined) ?? catalog[key]
  return message === undefined ? undefined : resolve(message, language, params)
}

export function translate(
  key: string,
  params?: TranslationParams,
  language = getUiLanguage(),
): string {
  const context = params?.context
  const message =
    lookup(key, context, language, params) ??
    (language === 'en' ? undefined : lookup(key, context, 'en', params)) ??
    key
  return message.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
    name === 'context' ? match : (interpolated(name, params?.[name], language) ?? match),
  )
}

export function useI18n(): { language: UiLanguage; t: Translator } {
  const language = useLocaleStore((s) => s.language)
  const t = useCallback<Translator>((key, params) => translate(key, params, language), [language])
  return { language, t }
}

export function useTranslation(): Translator {
  return useI18n().t
}
