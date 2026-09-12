import { useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChevronDown, Plus } from 'lucide-react'

import { meApi } from '@/api/me'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUserStore } from '@/stores/userStore'
import { useI18n } from '@/lib/i18n'
import {
  learningLanguageFlag,
  learningLanguageLabel,
  type LearningLanguageCode,
} from '@/lib/languages'

import { AddLanguageDialog } from './AddLanguageDialog'

export function LanguagePicker() {
  const { language, t } = useI18n()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { lang?: string }
  const user = useUserStore((s) => s.user)
  const setCurrentLang = useUserStore((s) => s.setCurrentLang)
  const [addOpen, setAddOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (!user) return null
  const currentLang = params.lang ?? user.last_learning_language_code ?? user.learning_languages[0]
  if (!currentLang) return null

  async function pick(lang: LearningLanguageCode) {
    if (lang === currentLang) return
    try {
      await meApi.setLastLanguage(lang)
    } catch {
      // ignore — picker still navigates; backend will reject if invalid
    }
    setCurrentLang(lang)
    await navigate({ to: '/learn/$lang/library', params: { lang } })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={`${t('Язык материала')}: ${learningLanguageLabel(currentLang, language)}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent"
        >
          <span aria-hidden="true">{learningLanguageFlag(currentLang)}</span>
          <span className="font-medium">{learningLanguageLabel(currentLang, language)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {user.learning_languages.map((code) => (
            <DropdownMenuItem
              key={code}
              onClick={() => {
                void pick(code)
              }}
              className="gap-2"
            >
              <span aria-hidden="true">{learningLanguageFlag(code)}</span>
              <span>{learningLanguageLabel(code, language)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAddOpen(true)} className="gap-2">
            <Plus aria-hidden="true" />
            <span>{t('Добавить язык')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddLanguageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        returnFocusRef={triggerRef}
      />
    </>
  )
}
