import { useI18n, setUiLanguage, type UiLanguage } from '@/lib/i18n'
import { useEffect, useId, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, getApiErrorKey } from '@/api/client'
import { meApi, type MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import {
  LEARNING_LANGUAGES,
  TRANSLATION_LANGUAGES,
  isLearningLanguageCode,
  learningLanguageLabel,
  translationLanguageLabel,
  type LearningLanguageCode,
  type TranslationLanguageCode,
} from '@/lib/languages'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface UiLang {
  code: UiLanguage
  name: string
}
const UI_LANGS: UiLang[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
]

/**
 * Loads the profile before showing the form: the route has no ProtectedRoute, and a
 * migrated user must see their current learning languages — submitting replaces them.
 */
export function OnboardingForm() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    retry: false,
  })
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null)
  const unauthenticated = error instanceof ApiError && error.status === 401

  useEffect(() => {
    if (data) {
      setUser(data)
      setHydratedUserId(data.id)
    }
  }, [data, setUser])

  useEffect(() => {
    if (unauthenticated) void navigate({ to: '/login' })
  }, [unauthenticated, navigate])

  // Like ProtectedRoute: render once the store holds this profile, so the form
  // starts in the profile's interface language.
  if (data && hydratedUserId === data.id) return <OnboardingFields key={data.id} profile={data} />
  if (isError && !unauthenticated) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p role="alert">{t('Не удалось загрузить профиль.')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t('Повторить')}
        </Button>
      </div>
    )
  }
  return <p className="text-muted-foreground">{t('Загрузка…')}</p>
}

function OnboardingFields({ profile }: { profile: MeResponse }) {
  const { language: uiLang, t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setUser = useUserStore((s) => s.setUser)
  const profileUiLang: UiLanguage = profile.ui_language_code === 'en' ? 'en' : 'ru'
  // A migrated user whose interface language is also a learning language comes back
  // here with native unset: keep their languages so they can drop the one they speak.
  const [learning, setLearning] = useState<Set<LearningLanguageCode>>(
    () => new Set(profile.learning_languages),
  )
  const [native, setNative] = useState<TranslationLanguageCode | null>(
    () => profile.native_language_code ?? (learning.has(profileUiLang) ? null : profileUiLang),
  )
  const [nativeChosen, setNativeChosen] = useState(() => profile.native_language_code != null)
  const [removedLanguage, setRemovedLanguage] = useState<LearningLanguageCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const nativeNoteId = useId()

  function changeUiLanguage(value: UiLanguage) {
    setUiLanguage(value)
    // Until the learner picks a native language, it follows the interface language.
    if (!nativeChosen && !learning.has(value)) setNative(value)
  }

  function chooseNative(code: TranslationLanguageCode) {
    setNativeChosen(true)
    setNative(code)
    if (isLearningLanguageCode(code) && learning.has(code)) {
      setLearning((prev) => {
        const next = new Set(prev)
        next.delete(code)
        return next
      })
      setRemovedLanguage(code)
    } else {
      setRemovedLanguage(null)
    }
  }

  function toggleLearning(code: LearningLanguageCode) {
    setLearning((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!native) {
      setError('Выберите родной язык')
      return
    }
    if (learning.size === 0) {
      setError('Выберите хотя бы один язык')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const langs = Array.from(learning)
      const result = await meApi.onboarding({
        ui_language: uiLang,
        learning_languages: langs,
        native_language: native,
      })
      const me = await meApi.get()
      setUser(me)
      // ProtectedRoute trusts a fresh ['me'] entry; a stale needs_onboarding would bounce back.
      queryClient.setQueryData(['me'], me)
      // Use the redirect from the API response (e.g. /learn/pt/library)
      // langs is non-empty because we checked learning.size === 0 above
      const lang = langs[0]!
      void result
      await navigate({ to: '/learn/$lang/library', params: { lang } })
    } catch (reason) {
      setError(getApiErrorKey(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="w-full max-w-md space-y-6">
      <h1 className="text-2xl font-semibold text-center">{t('Добро пожаловать в Glosano')}</h1>

      <div className="space-y-2">
        <Label htmlFor="onboarding-ui-language">{t('Язык интерфейса')}</Label>
        <Select value={uiLang} onValueChange={(value) => changeUiLanguage(value as UiLanguage)}>
          <SelectTrigger id="onboarding-ui-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UI_LANGS.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-native-language">{t('Родной язык')}</Label>
        <Select
          required
          value={native ?? ''}
          onValueChange={(value) => chooseNative(value as TranslationLanguageCode)}
        >
          <SelectTrigger id="onboarding-native-language" aria-required="true">
            <SelectValue placeholder={t('Выберите язык')} />
          </SelectTrigger>
          <SelectContent>
            {TRANSLATION_LANGUAGES.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                <span aria-hidden="true">{item.flag}</span>
                {translationLanguageLabel(item.code, uiLang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('Новые переводы делаются на этот язык. Сохранённые переводы не меняются.')}
        </p>
        {/* Always mounted so screen readers announce the note when it appears. */}
        <p role="status" className="text-xs text-muted-foreground empty:hidden">
          {removedLanguage &&
            t(
              '{{language}} убран из изучаемых: родной язык нельзя изучать. Уроки и словарь сохранены.',
              { language: learningLanguageLabel(removedLanguage, uiLang) },
            )}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t('Я хочу изучать')}</Label>
        <div className="space-y-2 rounded-md border p-3">
          {LEARNING_LANGUAGES.map((item) => {
            const isNative = item.code === native
            return (
              <div key={item.code} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={learning.has(item.code)}
                    disabled={isNative}
                    aria-describedby={isNative ? nativeNoteId : undefined}
                    onCheckedChange={() => {
                      toggleLearning(item.code)
                    }}
                  />
                  <span aria-hidden="true">{item.flag}</span>
                  <span>{learningLanguageLabel(item.code, uiLang)}</span>
                </label>
                {isNative && (
                  <span id={nativeNoteId} className="text-xs text-muted-foreground">
                    {t('Это ваш родной язык — смените его выше')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('Можно выбрать несколько')}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {t('Готово')}
      </Button>
    </form>
  )
}
