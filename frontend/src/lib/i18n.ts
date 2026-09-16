import { useCallback } from 'react'
import { create } from 'zustand'

import { useUserStore } from '@/stores/userStore'

export type UiLanguage = 'en' | 'ru'
export type TranslationParams = Record<string, string | number>
export type Translator = (key: string, params?: TranslationParams) => string

const STORAGE_KEY = 'glosano.ui-language'
const catalogs = import.meta.glob<Record<string, Record<string, string>>>('./locales/*.ts', {
  eager: true,
})
export const englishMessages: Record<string, string> = Object.assign(
  {},
  ...Object.values(catalogs).flatMap((module) => Object.values(module)),
)

function asLanguage(value: unknown): UiLanguage | undefined {
  return value === 'en' || value === 'ru' ? value : undefined
}

function storedLanguage(): UiLanguage {
  try {
    return asLanguage(localStorage.getItem(STORAGE_KEY)) ?? 'ru'
  } catch {
    return 'ru'
  }
}

const useLocaleStore = create<{ language: UiLanguage }>(() => ({ language: storedLanguage() }))

export function getUiLanguage(): UiLanguage {
  return (
    asLanguage(useUserStore.getState().user?.ui_language_code) ?? useLocaleStore.getState().language
  )
}

export function persistUiLanguage(language: UiLanguage): void {
  if (useLocaleStore.getState().language !== language) useLocaleStore.setState({ language })
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* Private browsing may disable storage. */
  }
}

export function setUiLanguage(language: UiLanguage): void {
  persistUiLanguage(language)
  const user = useUserStore.getState().user
  if (user && user.ui_language_code !== language) {
    useUserStore.setState({ user: { ...user, ui_language_code: language } })
  }
}

export function translate(
  key: string,
  params?: TranslationParams,
  language = getUiLanguage(),
): string {
  const message = language === 'en' ? (englishMessages[key] ?? key) : key
  return message.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
    String(params?.[name] ?? match),
  )
}

export function useI18n(): { language: UiLanguage; t: Translator } {
  const profileLanguage = useUserStore((s) => asLanguage(s.user?.ui_language_code))
  const localLanguage = useLocaleStore((s) => s.language)
  const language = profileLanguage ?? localLanguage
  const t = useCallback<Translator>((key, params) => translate(key, params, language), [language])
  return { language, t }
}

export function useTranslation(): Translator {
  return useI18n().t
}
