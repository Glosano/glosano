import { useTranslation, useI18n, translate } from '@/lib/i18n'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { reviewApi } from '@/api/review'
import type { ReviewSessionResult } from './useReviewSession'

interface SessionShellProps {
  subtitle?: string
  idx?: number
  total?: number
  children: ReactNode
}

export function SessionShell({ subtitle, idx, total, children }: SessionShellProps) {
  const t = useTranslation()
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-1 text-xl font-semibold">{t('Повторение')}</h1>
      {subtitle && <p className="mb-4 text-sm text-muted-foreground">{subtitle}</p>}
      {idx !== undefined && total !== undefined && (
        <p className="mb-4 text-sm text-muted-foreground">
          {idx + 1} / {total}
        </p>
      )}
      {children}
    </div>
  )
}

const GRADUATION_TOAST_MS = 3000

export function GraduationToast({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslation()
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  // Тот же паттерн, что UndoToast: таймер взводится один раз при монтировании.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), GRADUATION_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      data-testid="graduation-toast"
      className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
    >
      <div className="rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg">
        {t('Слово выучено ✓')}
      </div>
    </div>
  )
}

interface SessionSummaryProps {
  results: ReviewSessionResult['results']
  restart: () => void
  graduated: boolean
  dismissGraduation: () => void
  lessonId?: string
  showWriting?: boolean
}

export function SessionSummary(props: SessionSummaryProps) {
  const { language } = useI18n()
  return <SessionSummaryContent key={language} {...props} />
}

function SessionSummaryContent({
  results,
  restart,
  graduated,
  dismissGraduation,
  lessonId,
  showWriting,
}: SessionSummaryProps) {
  const { language, t } = useI18n()
  const avg =
    results.length > 0 ? results.reduce((sum, r) => sum + r.quality, 0) / results.length : 0
  const toRepeat = results.filter((r) => r.quality < 4)

  const writing = useMutation({
    mutationFn: () =>
      reviewApi.exercise<{ text: string }>({
        kind: 'writing',
        // backend ExerciseRequest.review_item_ids ограничен max_length=20
        review_item_ids: toRepeat.slice(0, 20).map((r) => r.item.review_item_id),
      }),
  })

  return (
    <>
      <p className="text-lg font-medium">{t('Сессия завершена')}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('Средняя оценка: {{score}}', {
          score: new Intl.NumberFormat(language, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(avg),
        })}
      </p>
      {toRepeat.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {toRepeat.map((r) => (
            <li key={r.item.review_item_id}>
              {t('Повторите ещё раз:')} {r.item.text} — {r.item.translation ?? '—'}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-3 underline" onClick={restart}>
        {lessonId ? t('Пройти ещё раз') : t('Повторить ошибки')}
      </button>
      {showWriting && toRepeat.length > 0 && (
        <div className="mt-4">
          {!writing.data && !writing.isError && (
            <button
              type="button"
              className="underline"
              disabled={writing.isPending}
              onClick={() => writing.mutate()}
            >
              {t('Письменное упражнение по ошибкам')}
            </button>
          )}
          {writing.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">{t('Готовим упражнение…')}</p>
          )}
          {writing.isError && (
            <div className="mt-2">
              <p className="text-sm text-destructive">{t('Не удалось сгенерировать упражнение')}</p>
              <button type="button" className="underline" onClick={() => writing.mutate()}>
                {t('Повторить')}
              </button>
            </div>
          )}
          {writing.data && (
            <pre className="mt-4 whitespace-pre-wrap text-left text-sm">
              {writing.data.payload.text}
            </pre>
          )}
        </div>
      )}
      {graduated && <GraduationToast onDismiss={dismissGraduation} />}
    </>
  )
}

interface LessonEmptyStateProps {
  lang?: string
}

/**
 * Пустой экран в скоупе урока: провенанс (FLQ-21) не бэкфиллится, поэтому на
 * уроках, прочитанных до релиза, этот экран показывается даже там, где
 * пользователь добавил десятки слов старым способом — текст не должен
 * читаться как «в уроке ничего нет», а объяснять, что видно именно здесь.
 * Используется и в SessionStates (карточки/квизы/новые слова), и в
 * TranslationSession, у которой свой собственный empty-путь.
 */
export function LessonEmptyState({ lang }: LessonEmptyStateProps) {
  const t = useTranslation()
  return (
    <>
      <p className="text-lg font-medium">{t('В этом уроке пока нет слов')}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          'Здесь появятся слова и фразы, которые вы добавите в этом уроке. Слова, добавленные раньше, доступны в общем повторении.',
        )}
      </p>
      {lang && (
        <Link
          to="/learn/$lang/review"
          params={{ lang }}
          search={{}}
          className="mt-3 inline-block underline"
        >
          {t('Повторить весь словарь')}
        </Link>
      )}
    </>
  )
}

/**
 * Возвращает JSX для не-active статусов сессии (loading/error/limit/empty/done)
 * или null, если сессия активна (карточка/упражнение должны рендериться вызывающим кодом).
 */
export function SessionStates(
  s: ReviewSessionResult,
  subtitle?: string,
  opts?: { lessonId?: string; showWriting?: boolean; lang?: string },
) {
  const t = translate
  if (s.status === 'loading') {
    return <SessionShell subtitle={subtitle}>{t('Загрузка…')}</SessionShell>
  }
  if (s.status === 'error') {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-destructive">{t('Не удалось загрузить очередь')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void s.retryQueue()}>
          {t('Повторить')}
        </button>
      </SessionShell>
    )
  }
  if (s.status === 'limit') {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">{t('Дневной лимит достигнут')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Сегодня: {{done}} / {{limit}}. Возвращайтесь завтра!', {
            done: s.daily?.done_today ?? 0,
            limit: s.daily?.limit ?? 0,
          })}
        </p>
      </SessionShell>
    )
  }
  if (s.status === 'empty') {
    if (opts?.lessonId) {
      return (
        <SessionShell subtitle={subtitle}>
          <LessonEmptyState lang={opts.lang} />
        </SessionShell>
      )
    }
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">{t('Всё повторено')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('Нет карточек к повторению.')}</p>
      </SessionShell>
    )
  }
  if (s.status === 'done') {
    return (
      <SessionShell subtitle={subtitle}>
        <SessionSummary
          results={s.results}
          restart={s.restart}
          graduated={s.graduated}
          dismissGraduation={s.dismissGraduation}
          lessonId={opts?.lessonId}
          showWriting={opts?.showWriting}
        />
      </SessionShell>
    )
  }
  return null
}
