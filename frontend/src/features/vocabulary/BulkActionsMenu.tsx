import { useI18n } from '@/lib/i18n'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

export type BulkAction = 'set_known' | 'set_ignored' | 'delete' | 'add_tag'

interface Props {
  count: number
  onAction: (action: BulkAction, tagName?: string) => void
}

export function BulkActionsMenu({ count, onAction }: Props) {
  const { t: tr } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  function closeMenu() {
    setMenuOpen(false)
    setTagInputOpen(false)
    setTagDraft('')
  }

  function submitTag() {
    const tag = tagDraft.trim()
    if (tag === '') return
    onAction('add_tag', tag)
    closeMenu()
  }

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (!open) {
            setTagInputOpen(false)
            setTagDraft('')
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={count === 0}
            className="h-8 gap-1 border-0 px-2 text-[13px] font-normal text-[var(--vocab-muted-fg)] hover:bg-transparent hover:text-[var(--vocab-term-fg)]"
          >
            {tr('More actions ({{value0}})', { value0: count })}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              onAction('set_known')
              closeMenu()
            }}
          >
            {tr('Mark as known')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              onAction('set_ignored')
              closeMenu()
            }}
          >
            {tr('Mark as ignored')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setTagInputOpen(true)
            }}
          >
            {tr('Add a tag…')}
          </DropdownMenuItem>
          {tagInputOpen && (
            <div className="flex items-center gap-1.5 p-1.5">
              <Input
                autoFocus
                aria-label={tr('Tag name')}
                value={tagDraft}
                onChange={(e) => { setTagDraft(e.target.value) }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitTag()
                  }
                }}
              />
              <Button type="button" size="sm" onClick={submitTag}>
                {tr('Add')}
              </Button>
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault()
              setDeleteConfirmOpen(true)
              closeMenu()
            }}
          >
            {tr('Delete from vocabulary')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr('Delete {{count}} words?', { count })}</DialogTitle>
            <DialogDescription>{tr('Translations, notes and tags will be deleted')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setDeleteConfirmOpen(false) }}
            >
              {tr('Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDeleteConfirmOpen(false)
                onAction('delete')
              }}
            >
              {tr('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
