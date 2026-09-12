import { useI18n, setUiLanguage, type UiLanguage } from '@/lib/i18n'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import {
  LEARNING_LANGUAGES,
  learningLanguageLabel,
  type LearningLanguageCode,
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

export function OnboardingForm() {
  const { language: uiLang, t } = useI18n()
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)
  const [learning, setLearning] = useState<Set<LearningLanguageCode>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        translation_language: uiLang,
      })
      const me = await meApi.get()
      setUser(me)
      // Use the redirect from the API response (e.g. /learn/pt/library)
      // langs is non-empty because we checked learning.size === 0 above
      const lang = langs[0]!
      void result
      await navigate({ to: '/learn/$lang/library', params: { lang } })
    } catch {
      setError('Не удалось сохранить настройки. Попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="w-full max-w-md space-y-6">
      <h1 className="text-2xl font-semibold text-center">{t('Добро пожаловать в Flinq')}</h1>

      <div className="space-y-2">
        <Label htmlFor="onboarding-ui-language">{t('Язык интерфейса')}</Label>
        <Select value={uiLang} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
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
        <Label>{t('Я хочу изучать')}</Label>
        <div className="space-y-2 rounded-md border p-3">
          {LEARNING_LANGUAGES.map((item) => (
            <label key={item.code} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={learning.has(item.code)}
                onCheckedChange={() => {
                  toggleLearning(item.code)
                }}
              />
              <span aria-hidden="true">{item.flag}</span>
              <span>{learningLanguageLabel(item.code, uiLang)}</span>
            </label>
          ))}
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
