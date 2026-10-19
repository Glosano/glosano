import { Ellipsis } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n'

interface Props {
  onImportLingq: () => void
}

/** The vocabulary page's «⋯» menu: imports now, exports later (FLQ-14). */
export function VocabularyMoreMenu({ onImportLingq }: Props) {
  const { t } = useI18n()
  return (
    // Non-modal, so the dialog opened from an item does not inherit the menu's pointer lock.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('More actions')}
          className="text-[var(--vocab-muted-fg)] hover:bg-transparent hover:text-[var(--vocab-term-fg)]"
        >
          <Ellipsis aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onImportLingq}>{t('Import from LingQ…')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
