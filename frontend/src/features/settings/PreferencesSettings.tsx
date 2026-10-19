import { useId, useState } from 'react'

import { getApiErrorKey } from '@/api/client'
import { meApi } from '@/api/me'
import { useI18n, type UiLanguage, msg } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { UI_LANGUAGE_CODES, uiLanguageEndonym } from '@/lib/uiLanguages'
import {
  LEARNING_LANGUAGES,
  TRANSLATION_LANGUAGES,
  isLearningLanguageCode,
  learningLanguageLabel,
  translationLanguageLabel,
  type LearningLanguageCode,
  type TranslationLanguageCode,
} from '@/lib/languages'
import { buttonClass, FormMessage, inputClass, SettingsSection } from './shared'
import { useApplyProfile } from './useApplyProfile'

export function PreferencesSettings() {
  const { language, t } = useI18n()
  const user = useUserStore((s) => s.user)
  const applyProfile = useApplyProfile()
  const [locale, setLocale] = useState<UiLanguage>(language)
  const [native, setNative] = useState<TranslationLanguageCode>(
    user?.native_language_code ?? language,
  )
  const [languages, setLanguages] = useState<LearningLanguageCode[]>(user?.learning_languages ?? [])
  const [minutes, setMinutes] = useState(String(user?.daily_goal_minutes ?? 15))
  const [reviews, setReviews] = useState(String(user?.daily_goal_reviews ?? 500))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const nativeNoteId = useId()

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSaved(false)
    if (!languages.length) {
      setError(msg('Choose at least one language.'))
      return
    }
    const m = Number(minutes)
    const r = Number(reviews)
    if (!Number.isInteger(m) || m < 1 || m > 1440 || !Number.isInteger(r) || r < 1 || r > 10000) {
      setError(msg('Enter a whole number within the allowed range.'))
      return
    }
    setPending(true)
    try {
      const languageLoaded = await applyProfile(
        await meApi.updatePreferences({
          ui_language: locale,
          learning_languages: languages,
          native_language: native,
          daily_goal_minutes: m,
          daily_goal_reviews: r,
        }),
      )
      if (languageLoaded) setSaved(true)
      else
        setError(
          msg(
            'Your preferences were saved, but the interface language could not be loaded. Reload the page to try again.',
          ),
        )
    } catch (reason) {
      setError(getApiErrorKey(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection title={t('Preferences')}>
      <form noValidate onSubmit={(e) => void save(e)} className="space-y-6">
        <div>
          <label htmlFor="ui-language" className="block text-sm font-medium">
            {t('Interface language')}
            <select
              id="ui-language"
              className={inputClass}
              value={locale}
              onChange={(e) => setLocale(e.target.value as UiLanguage)}
            >
              {UI_LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {uiLanguageEndonym(code)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Instructions and explanations will use the interface language.')}
          </p>
        </div>
        <div>
          <label htmlFor="native-language" className="block text-sm font-medium">
            {t('Native language')}
            <select
              id="native-language"
              className={inputClass}
              value={native}
              onChange={(e) => setNative(e.target.value as TranslationLanguageCode)}
            >
              {TRANSLATION_LANGUAGES.map((item) => (
                <option
                  key={item.code}
                  value={item.code}
                  // A learning language must be removed below before it can become native.
                  disabled={isLearningLanguageCode(item.code) && languages.includes(item.code)}
                >
                  {item.flag} {translationLanguageLabel(item.code, language)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('New translations are made into this language. Saved translations stay unchanged.')}
          </p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('Learning languages')}</legend>
          <div className="flex flex-col items-start gap-3">
            {LEARNING_LANGUAGES.map((item) => {
              const isNative = item.code === native
              return (
                <div key={item.code} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={languages.includes(item.code)}
                      disabled={isNative}
                      aria-describedby={isNative ? nativeNoteId : undefined}
                      onChange={(e) =>
                        setLanguages(
                          e.target.checked
                            ? [...languages, item.code]
                            : languages.filter((languageCode) => languageCode !== item.code),
                        )
                      }
                    />
                    <span aria-hidden="true">{item.flag}</span>
                    <span>{learningLanguageLabel(item.code, language)}</span>
                  </label>
                  {isNative && (
                    <span id={nativeNoteId} className="text-xs text-muted-foreground">
                      {t('This is your native language — change it above')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Removing a language from this list keeps your lessons, vocabulary and progress.')}
          </p>
        </fieldset>
        <div>
          <label htmlFor="minutes" className="block text-sm font-medium">
            {t('Reading goal, minutes per day')}
            <input
              id="minutes"
              className={inputClass}
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('A personal goal. Reading time is not measured yet.')}
          </p>
        </div>
        <label htmlFor="reviews" className="block text-sm font-medium">
          {t('Daily review limit')}
          <input
            id="reviews"
            className={inputClass}
            type="number"
            min={1}
            max={10000}
            step={1}
            required
            value={reviews}
            onChange={(e) => setReviews(e.target.value)}
          />
        </label>
        <FormMessage error={error && t(error)} success={saved ? t('Saved') : ''} />
        <button className={buttonClass} disabled={pending}>
          {t(pending ? msg('Saving…') : msg('Save preferences'))}
        </button>
      </form>
    </SettingsSection>
  )
}
