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
import { useTranslation, msg } from '@/lib/i18n'
import type { VideoAdvance, ViewMode } from '../readerStore'

const OPTIONS: { value: VideoAdvance; label: string; Icon: LucideIcon }[] = [
  { value: 'stop', label: msg('Stop'), Icon: CircleStop },
  { value: 'play', label: msg('Play on turn'), Icon: StepForward },
  { value: 'auto', label: msg('Advance automatically'), Icon: FastForward },
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
  const label = `${tr('Page turning')}: ${tr(current.label, { context: 'video' })}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" disabled={disabled} aria-label={label} title={label}>
          <current.Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" collisionPadding={{ bottom: 72 }}>
        <DropdownMenuLabel>{tr('Page turning')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as VideoAdvance)}
        >
          {OPTIONS.map(({ value: option, label: text, Icon }) => (
            <DropdownMenuRadioItem key={option} value={option} disabled={disabled}>
              <Icon aria-hidden />
              {tr(text, { context: 'video' })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value === 'auto' && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {tr(
              mode === 'page'
                ? msg('New words on the page you leave become known. You can undo this.')
                : msg('New words in the fragment you leave become known. You can undo this.'),
            )}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
