import { useTranslation } from '@/lib/i18n'
import type { VideoAdvance, ViewMode } from '../readerStore'

const OPTIONS: [VideoAdvance, string][] = [
  ['stop', 'Стоп'],
  ['play', 'Играть при листании'],
  ['auto', 'Листать автоматически'],
]

interface Props {
  mode: ViewMode
  value: VideoAdvance
  disabled?: boolean
  onChange(value: VideoAdvance): void
}

export function VideoAdvanceChoice({ mode, value, disabled, onChange }: Props) {
  const tr = useTranslation()
  return (
    <fieldset disabled={disabled} className="space-y-2 disabled:opacity-50">
      <legend className="mb-2 font-medium">{tr('Воспроизведение')}</legend>
      <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
        {OPTIONS.map(([option, label]) => (
          <label
            key={option}
            className="cursor-pointer rounded-md px-3 py-1.5 has-checked:bg-accent has-checked:font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              name="video-advance"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {tr(label)}
          </label>
        ))}
      </div>
      {value === 'auto' && (
        <p className="text-xs text-muted-foreground">
          {tr(
            mode === 'page'
              ? 'Новые слова покинутой страницы становятся известными. Действие можно отменить.'
              : 'Новые слова покинутого фрагмента становятся известными. Действие можно отменить.',
          )}
        </p>
      )}
    </fieldset>
  )
}
