import { useTranslation, msg } from '@/lib/i18n'
const GRADE_LABELS: Record<number, string> = {
  5: msg('Recalled immediately'),
  4: msg('Recalled'),
  3: msg('Recalled with difficulty'),
  2: msg('Almost recalled'),
  1: msg('Recognized after reveal'),
  0: msg('Could not recall'),
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
        {t('Rate how easily you recalled the word.')}
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
