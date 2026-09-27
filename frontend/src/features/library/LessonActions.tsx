import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Tags, Trash2 } from 'lucide-react'

import { lessonsApi, type LessonSummary } from '@/api/lessons'
import { getApiErrorMessage } from '@/api/client'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/lib/i18n'
import { invalidateMaterial } from './materialQueries'
import { LessonTagsDialog } from './LessonTagsDialog'

export function LessonActions({ lesson }: { lesson: LessonSummary }) {
  const t = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="outline"
            size="icon"
            className="absolute right-2 top-2 size-9 bg-background/95 shadow-sm"
            aria-label={t('Действия с материалом')}
          >
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-40"
          onCloseAutoFocus={(event) => {
            if (deleting || editingTags) event.preventDefault()
          }}
        >
          <DropdownMenuItem onSelect={() => setEditingTags(true)}>
            <Tags aria-hidden="true" />
            {t('Теги…')}
          </DropdownMenuItem>
          {lesson.can_manage && (
            <>
              <DropdownMenuItem asChild>
                <Link
                  to="/learn/$lang/lessons/$lessonId/edit"
                  params={{ lang: lesson.language_code, lessonId: lesson.id }}
                >
                  <Pencil aria-hidden="true" />
                  {t('Редактировать')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                {t('Удалить')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting && (
        <DeleteMaterialDialog
          lesson={lesson}
          onClose={() => setDeleting(false)}
          onRestoreFocus={() => trigger.current?.focus()}
        />
      )}
      {editingTags && (
        <LessonTagsDialog
          lesson={lesson}
          onClose={() => setEditingTags(false)}
          onRestoreFocus={() => trigger.current?.focus()}
        />
      )}
    </>
  )
}

function DeleteMaterialDialog({
  lesson,
  onClose,
  onRestoreFocus,
}: {
  lesson: LessonSummary
  onClose: () => void
  onRestoreFocus: () => void
}) {
  const t = useTranslation()
  const queryClient = useQueryClient()
  const cancel = useRef<HTMLButtonElement>(null)
  const deletion = useMutation({
    mutationFn: () => lessonsApi.delete(lesson.id),
    onSuccess: () => {
      onClose()
      void invalidateMaterial(queryClient, lesson.id, lesson.language_code)
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !deletion.isPending) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancel.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('Удалить материал?')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {t(
              'Материал «{{title}}» будет удалён без возможности восстановления. Сохранённые слова и повторения останутся.',
              { title: lesson.title },
            )}
          </DialogDescription>
        </DialogHeader>
        {deletion.isError && (
          <p role="alert" className="text-sm text-destructive">
            {getApiErrorMessage(deletion.error)}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancel} variant="outline" disabled={deletion.isPending} onClick={onClose}>
            {t('Отмена')}
          </Button>
          <Button
            variant="destructive"
            disabled={deletion.isPending}
            onClick={() => deletion.mutate()}
          >
            {deletion.isPending ? t('Удаление…') : t('Да')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
