import { CircleStop, FastForward, StepForward, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/lib/i18n'
import type { VideoAdvance, ViewMode } from '../readerStore'

const OPTIONS: { value: VideoAdvance; label: string; Icon: LucideIcon }[] = [
  { value: 'stop', label: 'Стоп', Icon: CircleStop },
  { value: 'play', label: 'Играть при листании', Icon: StepForward },
  { value: 'auto', label: 'Листать автоматически', Icon: FastForward },
]

interface Props {
  mode: ViewMode
  value: VideoAdvance
  disabled?: boolean
  onChange(value: VideoAdvance): void
}

export function VideoAdvanceMenu({ mode, value, disabled, onChange }: Props) {
  const tr = useTranslation()
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0]!
  const label = `${tr('Режим листания')}: ${tr(current.label)}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" disabled={disabled} aria-label={label} title={label}>
          <current.Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" collisionPadding={{ bottom: 72 }}>
        <DropdownMenuLabel>{tr('Режим листания')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as VideoAdvance)}
        >
          {OPTIONS.map(({ value: option, label: text, Icon }) => (
            <DropdownMenuRadioItem key={option} value={option} disabled={disabled}>
              <Icon aria-hidden />
              {tr(text)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value === 'auto' && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {tr(
              mode === 'page'
                ? 'Новые слова покинутой страницы становятся известными. Действие можно отменить.'
                : 'Новые слова покинутого фрагмента становятся известными. Действие можно отменить.',
            )}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
