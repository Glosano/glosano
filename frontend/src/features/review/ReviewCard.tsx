import type { ReviewQueueItem } from '@/api/review'

interface Props {
  item: ReviewQueueItem
  flipped: boolean
  answering: boolean
  error: string | null
  onFlip: () => void
  onAnswer: (answer: 'correct' | 'wrong') => void
}

export function ReviewCard({ item, flipped, answering, error, onFlip, onAnswer }: Props) {
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
          Показать перевод
        </button>
      ) : (
        <>
          <hr className="my-4 border-border" />
          <p className="text-center text-xl">{item.translation ?? '—'}</p>
          {item.notes && (
            <p className="mt-2 text-center text-sm text-muted-foreground">{item.notes}</p>
          )}
          {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={answering}
              onClick={() => onAnswer('wrong')}
              className="rounded-md border border-border py-4 text-base hover:bg-accent disabled:opacity-50"
            >
              ✗ Ошибка
            </button>
            <button
              type="button"
              disabled={answering}
              onClick={() => onAnswer('correct')}
              className="rounded-md border border-border py-4 text-base hover:bg-accent disabled:opacity-50"
            >
              ✓ Знаю
            </button>
          </div>
        </>
      )}
    </div>
  )
}
