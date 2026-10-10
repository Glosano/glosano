import { useTranslation } from '@/lib/i18n'
const GRADE_LABELS: Record<number, string> = {
  5: 'Вспомнил сразу',
  4: 'Вспомнил',
  3: 'Вспомнил с трудом',
  2: 'Почти вспомнил',
  1: 'Узнал после ответа',
  0: 'Не вспомнил',
}

interface Props {
  onGrade: (quality: number) => void
  disabled: boolean
}

export function GradeBar({ onGrade, disabled }: Props) {
  const t = useTranslation()
  return (
    <div className="mt-6 w-full">
      <p className="mb-3 text-sm text-muted-foreground">
        {t('Оцените, насколько легко вы вспомнили слово.')}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(q)}
            aria-label={`${q} — ${t(GRADE_LABELS[q]!)}`}
            title={t(GRADE_LABELS[q]!)}
            className="flex min-h-14 min-w-11 flex-col items-center justify-center rounded-md border border-border px-2 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <span className="text-base font-medium">{q}</span>
            <span className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {t(GRADE_LABELS[q]!)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
