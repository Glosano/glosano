import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'

import { reviewApi } from '@/api/review'
import type { ReviewSessionResult } from './useReviewSession'

interface SessionShellProps {
  subtitle?: string
  idx?: number
  total?: number
  children: ReactNode
}

export function SessionShell({ subtitle, idx, total, children }: SessionShellProps) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-1 text-xl font-semibold">Повторение</h1>
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
        Слово выучено ✓
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

export function SessionSummary({
  results,
  restart,
  graduated,
  dismissGraduation,
  lessonId,
  showWriting,
}: SessionSummaryProps) {
  const avg = results.length > 0 ? results.reduce((sum, r) => sum + r.quality, 0) / results.length : 0
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
      <p className="text-lg font-medium">Сессия завершена</p>
      <p className="mt-1 text-sm text-muted-foreground">Средняя оценка: {avg.toFixed(1)}</p>
      {toRepeat.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {toRepeat.map((r) => (
            <li key={r.item.review_item_id}>
              Повторите ещё раз: {r.item.text} — {r.item.translation ?? '—'}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-3 underline" onClick={restart}>
        {lessonId ? 'Пройти ещё раз' : 'Повторить ошибки'}
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
              Письменное упражнение по ошибкам
            </button>
          )}
          {writing.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">Готовим упражнение…</p>
          )}
          {writing.isError && (
            <div className="mt-2">
              <p className="text-sm text-destructive">Не удалось сгенерировать упражнение</p>
              <button type="button" className="underline" onClick={() => writing.mutate()}>
                Повторить
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

/**
 * Возвращает JSX для не-active статусов сессии (loading/error/limit/empty/done)
 * или null, если сессия активна (карточка/упражнение должны рендериться вызывающим кодом).
 */
export function SessionStates(
  s: ReviewSessionResult,
  subtitle?: string,
  opts?: { lessonId?: string; showWriting?: boolean },
) {
  if (s.status === 'loading') {
    return <SessionShell subtitle={subtitle}>Загрузка…</SessionShell>
  }
  if (s.status === 'error') {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-destructive">Не удалось загрузить очередь</p>
        <button type="button" className="mt-2 underline" onClick={() => void s.retryQueue()}>
          Повторить
        </button>
      </SessionShell>
    )
  }
  if (s.status === 'limit') {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">Дневной лимит достигнут</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Сегодня: {s.daily?.done_today} / {s.daily?.limit}. Возвращайтесь завтра!
        </p>
      </SessionShell>
    )
  }
  if (s.status === 'empty') {
    return (
      <SessionShell subtitle={subtitle}>
        <p className="text-lg font-medium">Всё повторено</p>
        <p className="mt-1 text-sm text-muted-foreground">Нет карточек к повторению.</p>
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
