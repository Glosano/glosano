import { useId, useState } from 'react'
import { Languages } from 'lucide-react'

import { setUiLanguage, useI18n, type UiLanguage } from '@/lib/i18n'
import { UI_LANGUAGE_CODES, uiLanguageEndonym } from '@/lib/uiLanguages'

/**
 * Interface language before sign-in. Picking one is this device's explicit choice: it is stored,
 * and registration sends it as the new profile's interface language.
 */
export function AuthLanguagePicker() {
  const { language, t } = useI18n()
  const [requested, setRequested] = useState<UiLanguage | null>(null)
  const [failed, setFailed] = useState(false)
  const errorId = useId()

  async function choose(next: UiLanguage) {
    setFailed(false)
    setRequested(next)
    try {
      await setUiLanguage(next)
    } catch (error: unknown) {
      console.error(`Failed to load the "${next}" interface catalog`, error)
      setFailed(true)
    } finally {
      setRequested(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Languages aria-hidden="true" className="size-4" />
        <span className="sr-only">{t('Interface language')}</span>
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          // Endonyms, so the right language can be found without reading the current one.
          value={requested ?? language}
          disabled={requested !== null}
          aria-describedby={failed ? errorId : undefined}
          onChange={(e) => void choose(e.target.value as UiLanguage)}
        >
          {UI_LANGUAGE_CODES.map((code) => (
            <option key={code} value={code} lang={code}>
              {uiLanguageEndonym(code)}
            </option>
          ))}
        </select>
      </label>
      {failed && (
        <p id={errorId} role="alert" className="max-w-xs text-right text-sm text-destructive">
          {t('Could not load this language. Check your connection and try again.')}
        </p>
      )}
    </div>
  )
}
