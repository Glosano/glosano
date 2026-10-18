import { useTranslation } from '@/lib/i18n'
import { ForeignLanguageFlag } from '@/components/ForeignLanguageFlag'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { useQuery } from '@tanstack/react-query'
import { readerApi } from '@/api/reader'
import { ApiError } from '@/api/client'
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
      {item.context_sentence && (
        <div className="mt-4 text-left">
          <p className="text-xs text-muted-foreground">{t('Пример из материала')}</p>
          <p dir="auto" className="mt-1 text-base">
            {item.context_sentence}
          </p>
        </div>
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
          <p className="text-xs text-muted-foreground">{t('Ваш перевод')}</p>
          <p dir="auto" className="mt-1 text-center text-xl">
            {item.translation !== null && (
              <ForeignLanguageFlag code={item.translation_language_code} className="mr-2" />
            )}
            {item.translation ?? t('Перевод не сохранён')}
          </p>
          {item.context_sentence && item.context_lesson_id && item.context_segment_id && (
            <ContextTranslation
              key={`${item.context_lesson_id}:${item.context_segment_id}`}
              lessonId={item.context_lesson_id}
              segmentId={item.context_segment_id}
            />
          )}
          {item.notes && (
            <p className="mt-2 text-center text-sm text-muted-foreground">{item.notes}</p>
          )}
          {error && <p className="mt-3 text-center text-sm text-destructive">{t(error)}</p>}
        </>
      )}
    </div>
  )
}

function ContextTranslation({ lessonId, segmentId }: { lessonId: string; segmentId: string }) {
  const t = useTranslation()
  const target = useTranslationLanguage()
  const query = useQuery({
    queryKey: ['review-context-translation', lessonId, segmentId, target],
    queryFn: () => readerApi.segmentTranslation(lessonId, segmentId, target),
    staleTime: Infinity,
    retry: false,
  })
  return (
    <div className="mt-4 text-left text-sm">
      <p className="text-xs text-muted-foreground">{t('AI-перевод примера')}</p>
      {query.isPending && (
        <p role="status" className="mt-1 text-muted-foreground">
          {t('Переводим пример…')}
        </p>
      )}
      {query.data && (
        <p dir="auto" className="mt-1">
          {query.data.text}
        </p>
      )}
      {query.isError && (
        <div className="mt-1 text-muted-foreground">
          <p>
            {t(
              query.error instanceof ApiError && query.error.detail === 'ai_disabled'
                ? 'AI отключён'
                : 'Перевод примера недоступен. Можно продолжить повторение.',
            )}
          </p>
          <button type="button" className="min-h-11 underline" onClick={() => void query.refetch()}>
            {t('Повторить')}
          </button>
        </div>
      )}
    </div>
  )
}
