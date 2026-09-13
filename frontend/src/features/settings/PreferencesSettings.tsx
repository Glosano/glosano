import { useState } from 'react'

import { getApiErrorKey } from '@/api/client'
import { meApi } from '@/api/me'
import { useI18n, type UiLanguage } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { LEARNING_LANGUAGES, learningLanguageLabel } from '@/lib/languages'
import { buttonClass, FormMessage, inputClass, SettingsSection } from './shared'
import { useApplyProfile } from './useApplyProfile'

export function PreferencesSettings() {
  const { language, t } = useI18n()
  const user = useUserStore((s) => s.user)
  const applyProfile = useApplyProfile()
  const [locale, setLocale] = useState<UiLanguage>(language)
  const [languages, setLanguages] = useState(user?.learning_languages ?? [])
  const [minutes, setMinutes] = useState(String(user?.daily_goal_minutes ?? 15))
  const [reviews, setReviews] = useState(String(user?.daily_goal_reviews ?? 500))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSaved(false)
    if (!languages.length) {
      setError('Выберите хотя бы один язык.')
      return
    }
    const m = Number(minutes)
    const r = Number(reviews)
    if (!Number.isInteger(m) || m < 1 || m > 1440 || !Number.isInteger(r) || r < 1 || r > 10000) {
      setError('Укажите целое число в допустимом диапазоне.')
      return
    }
    setPending(true)
    try {
      await applyProfile(
        await meApi.updatePreferences({
          ui_language: locale,
          learning_languages: languages,
          daily_goal_minutes: m,
          daily_goal_reviews: r,
        }),
      )
      setSaved(true)
    } catch (reason) {
      setError(getApiErrorKey(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection title={t('Предпочтения')}>
      <form noValidate onSubmit={(e) => void save(e)} className="space-y-6">
        <div>
          <label htmlFor="ui-language" className="block text-sm font-medium">
            {t('Язык интерфейса')}
            <select
              id="ui-language"
              className={inputClass}
              value={locale}
              onChange={(e) => setLocale(e.target.value as UiLanguage)}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Переводы и инструкции будут на языке интерфейса.')}
          </p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('Изучаемые языки')}</legend>
          <div className="flex flex-col items-start gap-3">
            {LEARNING_LANGUAGES.map((item) => (
              <label key={item.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={languages.includes(item.code)}
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
            ))}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Удаление языка из списка сохраняет уроки, словарь и прогресс.')}
          </p>
        </fieldset>
        <div>
          <label htmlFor="minutes" className="block text-sm font-medium">
            {t('Цель чтения, минут в день')}
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
            {t('Личная цель. Время чтения пока не измеряется.')}
          </p>
        </div>
        <label htmlFor="reviews" className="block text-sm font-medium">
          {t('Лимит повторений в день')}
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
        <FormMessage error={error && t(error)} success={saved ? t('Сохранено') : ''} />
        <button className={buttonClass} disabled={pending}>
          {t(pending ? 'Сохранение…' : 'Сохранить предпочтения')}
        </button>
      </form>
    </SettingsSection>
  )
}
