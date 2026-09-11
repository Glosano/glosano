import { useTranslation } from '@/lib/i18n'
import type { ReviewQueueItem } from '@/api/review'

interface Props {
  item: ReviewQueueItem
  flipped: boolean
  error: string | null
  onFlip: () => void
}

export function ReviewCard({ item, flipped, error, onFlip }: Props) {
  const t = useTranslation()
  return (
    <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
      <p className="text-center text-2xl font-medium">{item.text}</p>
      {!flipped && item.context_sentence && (
        <p className="mt-3 text-center text-sm text-muted-foreground">{item.context_sentence}</p>
      )}
      {!flipped ? (
        <button
          type="button"
          onClick={onFlip}
          className="mt-6 w-full rounded-md border border-border py-3 text-sm hover:bg-accent"
        >
          {t('Показать перевод')}
        </button>
      ) : (
        <>
          <hr className="my-4 border-border" />
          <p className="text-center text-xl">{item.translation ?? '—'}</p>
          {item.notes && (
            <p className="mt-2 text-center text-sm text-muted-foreground">{item.notes}</p>
          )}
          {error && <p className="mt-3 text-center text-sm text-destructive">{t(error)}</p>}
        </>
      )}
    </div>
  )
}
