import { useEffect, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ArrowLeft, BookOpen } from 'lucide-react'

import { readerApi } from '@/api/reader'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

interface Props {
  lessonId: string
  actionId: string
  lang: string
  title: string
  busy: boolean
  undoError: boolean
  statusRef: RefObject<HTMLDivElement | null>
  onRead: () => void
  onUndo: () => void
}

export function CompletionScreen({
  lessonId,
  actionId,
  lang,
  title,
  busy,
  undoError,
  statusRef,
  onRead,
  onUndo,
}: Props) {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['completion-summary', lessonId, actionId],
    queryFn: async () => {
      const result = await readerApi.completionSummary(lessonId, actionId)
      if (result.action_id !== actionId) throw new ApiError(409, 'completion_changed')
      return result
    },
    staleTime: Infinity,
    retry: false,
  })
  useEffect(() => {
    statusRef.current?.focus()
  }, [actionId, statusRef])
  const changed = error instanceof ApiError && (error.status === 409 || error.status === 404)
  const summary = data?.summary
  const number = (value: number) => new Intl.NumberFormat(language).format(value)

  return (
    <section data-testid="completion-screen" className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
      <div
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className="text-center outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check aria-hidden="true" className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('Материал завершён')}
        </h1>
        <p className="mt-2 break-words text-muted-foreground">{title}</p>
      </div>

      {isPending && (
        <p role="status" className="my-10 text-center text-muted-foreground">
          {t('Загрузка итогов…')}
        </p>
      )}
      {isError && (
        <div role="alert" className="my-8 rounded-xl border border-border p-5 text-center">
          <p>
            {changed
              ? t('Завершение изменилось в другой вкладке. Обновите материал.')
              : t('Не удалось загрузить итоги. Завершение материала сохранено.')}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              if (changed) void queryClient.invalidateQueries({ queryKey: ['lesson', lessonId] })
              else void refetch()
            }}
          >
            {changed ? t('Обновить материал') : t('Повторить загрузку')}
          </Button>
        </div>
      )}
      {data && !summary && (
        <p className="my-10 text-center text-muted-foreground">
          {t('Этот материал завершён до появления итогов. Снимок статистики не сохранён.')}
        </p>
      )}
      {summary && (
        <div className="my-8 space-y-6">
          <dl className="grid grid-cols-2 gap-3">
            {[
              [t('Слов в тексте'), summary.total_words],
              [t('Уникальных слов'), summary.unique_words],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-5">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums">
                  {number(value as number)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-medium">{t('Слова перед завершением')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Уникальные словоформы до обработки последней страницы или предложения.')}
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
              {[
                [t('Известных'), summary.known_words],
                [t('Новых'), summary.new_words],
                [t('На изучении'), summary.tracked_words],
                [t('Игнорируемых'), summary.ignored_words],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {number(value as number)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
              {t('При завершении отмечено известными: {{count}}', {
                count: number(summary.marked_known_words),
              })}
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <dt className="text-sm text-muted-foreground">
                {t('Добавлено на изучение из материала')}
              </dt>
              <dd className="mt-2 text-xl font-semibold tabular-nums">
                {t('Слов: {{words}} · Фраз: {{phrases}}', {
                  words: number(summary.added_words),
                  phrases: number(summary.added_phrases),
                })}
              </dd>
              <p className="mt-2 text-xs text-muted-foreground">
                {t(
                  'Сохранённые слова и фразы, впервые взятые на изучение здесь. Автоматическая отметка «известно» не считается добавлением.',
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <dt className="text-sm text-muted-foreground">{t('Дней чтения')}</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums">
                {number(summary.reading_days)}
              </dd>
              <p className="mt-2 text-xs text-muted-foreground">
                {t(
                  'Дни с учтёнными словами в текущей версии текста, по UTC. Повтор в тот же день не добавляет день.',
                )}
              </p>
            </div>
          </dl>
          <p className="text-center text-xs text-muted-foreground">
            {t(
              'Снимок сохранён при завершении. Более ранняя история без учёта чтения не восстанавливается.',
            )}
          </p>
        </div>
      )}
      {undoError && (
        <p role="alert" className="my-4 text-center text-destructive">
          {t('Не удалось отменить завершение. Попробуйте ещё раз.')}
        </p>
      )}
      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
        <Button asChild>
          <Link to="/learn/$lang/library" params={{ lang }}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('В библиотеку')}
          </Link>
        </Button>
        <Button variant="outline" onClick={onRead} disabled={busy}>
          <BookOpen aria-hidden="true" className="size-4" />
          {t('Продолжить чтение')}
        </Button>
      </div>
      <div className="mt-4 text-center">
        <Button variant="ghost" disabled={busy || changed} onClick={onUndo}>
          {t('Отменить завершение')}
        </Button>
      </div>
    </section>
  )
}
