import { useTranslation } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { reviewApi, type ReviewMode } from '@/api/review'

const MODES: {
  mode: ReviewMode
  title: string
  hint: string
  countKey: 'due' | 'new' | 'practice'
  needsAi: boolean
}[] = [
  {
    mode: 'cards',
    title: 'Карточки',
    hint: 'Классические flip-карточки',
    countKey: 'due',
    needsAi: false,
  },
  {
    mode: 'new',
    title: 'Новые слова',
    hint: 'AI-пример и первое знакомство',
    countKey: 'new',
    needsAi: true,
  },
  {
    mode: 'cloze',
    title: 'Квиз: пропуск',
    hint: 'Предложение с пропуском, 4 варианта',
    countKey: 'due',
    needsAi: true,
  },
  {
    mode: 'reverse',
    title: 'Квиз: перевод',
    hint: 'Слово и 4 варианта перевода',
    countKey: 'due',
    needsAi: true,
  },
  {
    mode: 'translation',
    title: 'Практика перевода',
    hint: 'Переведи предложение, AI проверит',
    countKey: 'practice',
    needsAi: true,
  },
]

export function ModeSelect({ lang, lessonId }: { lang: string; lessonId?: string }) {
  const t = useTranslation()
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['review-counts', lang, lessonId ?? null],
    queryFn: () => reviewApi.counts(lang, lessonId),
  })

  if (isPending) return <p className="p-8 text-center">{t('Загрузка…')}</p>
  if (isError)
    return (
      <div className="p-8 text-center">
        <p className="text-destructive">{t('Не удалось загрузить счётчики')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void refetch()}>
          {t('Повторить')}
        </button>
      </div>
    )

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className={`${lessonId ? 'mb-1' : 'mb-6'} text-center text-xl font-semibold`}>
        {t('Повторение')}
      </h1>
      {lessonId && (
        <p className="mb-6 text-center text-sm text-muted-foreground">{t('Слова урока')}</p>
      )}
      <div className="grid gap-3">
        {MODES.map((m) => {
          const aiOff = m.needsAi && !data.ai_enabled
          return (
            <button
              key={m.mode}
              type="button"
              disabled={aiOff}
              onClick={() =>
                void navigate({
                  to: '/learn/$lang/review',
                  params: { lang },
                  search: { mode: m.mode, ...(lessonId ? { lessonId } : {}) },
                })
              }
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 text-left hover:bg-accent disabled:opacity-50"
            >
              <span>
                <span className="block font-medium">{t(m.title)}</span>
                <span className="block text-sm text-muted-foreground">
                  {aiOff ? t('AI отключён') : t(m.hint)}
                </span>
              </span>
              <span className="ml-4 text-2xl font-semibold">{data[m.countKey]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
