import { useI18n } from '@/lib/i18n'
import { translationLanguageFlag, translationLanguageLabel } from '@/lib/languages'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'

interface Props {
  /** Language of the saved translation; nothing renders without one. */
  code: string | null | undefined
  className?: string
}

/**
 * Marks a saved translation that is not in the native language — a leftover
 * from a previous native language (FLQ-47). Native-language translations carry
 * no flag. Screen readers hear the language name instead of the emoji.
 */
export function ForeignLanguageFlag({ code, className }: Props) {
  const native = useTranslationLanguage()
  const { language } = useI18n()
  if (!code || code === native) return null
  return (
    <span className={className}>
      <span aria-hidden="true">{translationLanguageFlag(code)}</span>
      <span className="sr-only">{translationLanguageLabel(code, language)}</span>
    </span>
  )
}
