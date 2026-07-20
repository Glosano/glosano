export const GRADE_LABELS: Record<number, string> = {
  5: 'Идеально',
  4: 'С заминкой',
  3: 'С трудом',
  2: 'Ошибка, легко вспомнил',
  1: 'Ошибка, вспомнил',
  0: 'Полный провал',
}

interface Props {
  onGrade: (quality: number) => void
  disabled: boolean
}

export function GradeBar({ onGrade, disabled }: Props) {
  return (
    <div className="mt-6 grid grid-cols-6 gap-2">
      {[0, 1, 2, 3, 4, 5].map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(q)}
          aria-label={`${q} — ${GRADE_LABELS[q]!}`}
          title={GRADE_LABELS[q]!}
          className="flex flex-col items-center rounded-md border border-border py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <span className="text-base font-medium">{q}</span>
          <span className="mt-0.5 hidden text-[10px] leading-tight text-muted-foreground sm:block">
            {GRADE_LABELS[q]!.split(',')[0]}
          </span>
        </button>
      ))}
    </div>
  )
}
