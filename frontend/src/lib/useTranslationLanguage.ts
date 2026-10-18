import { useI18n } from '@/lib/i18n'
import type { TranslationLanguageCode } from '@/lib/languages'
import { useUserStore } from '@/stores/userStore'

/**
 * Language new translations are made into: the learner's native language (ADR-0030).
 * The interface language is only a stand-in until the profile loads — protected
 * routes guarantee a native language once onboarding is complete.
 */
export function useTranslationLanguage(): TranslationLanguageCode {
  const native = useUserStore((state) => state.user?.native_language_code ?? null)
  const { language } = useI18n()
  return native ?? language
}
