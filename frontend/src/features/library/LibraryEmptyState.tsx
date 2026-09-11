import { useTranslation } from '@/lib/i18n'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ImportLessonDialog } from './ImportLessonDialog'

export function LibraryEmptyState() {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-xl font-semibold">{t('У вас пока нет уроков')}</h2>
      <p className="mt-2 text-muted-foreground">{t('Импортируйте свой первый текст')}</p>
      <Button
        className="mt-6"
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('+ Импортировать урок')}
      </Button>
      <ImportLessonDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
