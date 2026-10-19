import { useTranslation, useI18n, translate, msg } from '@/lib/i18n'
import { ForeignLanguageFlag } from '@/components/ForeignLanguageFlag'
import { useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { ReviewNavigationContext } from './reviewNavigation'
import type { ReviewSessionResult } from './useReviewSession'

interface SessionShellProps {
  subtitle?: string
  intro?: string
  idx?: number
  total?: number
  session?: ReviewSessionResult
  finish?: () => void
  busy?: boolean
  children: ReactNode
}

export function SessionShell({
  subtitle,
  intro,
  idx,
  total,
  session,
  finish,
  busy,
  children,
}: SessionShellProps) {
  const t = useTranslation()
  const nav = useContext(ReviewNavigationContext)
  const disabled = busy || session?.answering
  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-12 pt-6 text-center sm:pt-8">
      <header className="mb-6 min-h-36">
        <h1 className="text-xl font-semibold">{t('Review')}</h1>
        {subtitle && <p className="mt-1 font-medium">{subtitle}</p>}
        {nav?.returnToLesson && (
          <p
            className="mt-1 min-h-10 line-clamp-2 break-words text-sm text-muted-foreground"
            title={nav.lessonTitle ?? undefined}
          >
            {nav.lessonTitle ?? '\u00a0'}
          </p>
        )}
        <p className="mt-3 h-6 text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {idx !== undefined && total !== undefined
            ? `${Math.min(idx + 1, total)} / ${total}`
            : '\u00a0'}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-3">
          <button
            type="button"
            disabled={disabled || !(session?.status === 'active' || finish)}
            className={`min-h-11 underline disabled:opacity-50 ${session?.status === 'active' || finish ? '' : 'invisible'}`}
            onClick={finish ?? session?.finish}
          >
            {t('Finish session')}
          </button>
          {nav && (
            <button
              type="button"
              disabled={disabled}
              className="min-h-11 underline disabled:opacity-50"
              onClick={nav.choose}
            >
              {t('Choose an activity')}
            </button>
          )}
          {nav?.returnToLesson && (
            <button
              type="button"
              disabled={disabled}
              className="col-span-2 min-h-11 underline disabled:opacity-50"
              onClick={nav.returnToLesson}
            >
              {t('Back to material results')}
            </button>
          )}
        </div>
      </header>
      {session?.selectionSize !== undefined && session.status === 'active' && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('Mistakes from the previous session: {{count}} of {{total}} available.', {
            count: String(session.total),
            total: session.selectionSize,
          })}
        </p>
      )}
      <div className="w-full min-w-0 break-words">
        {intro && <p className="mb-4 text-sm text-muted-foreground">{intro}</p>}
        {children}
      </div>
    </section>
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
        {t('Word learned ✓')}
      </div>
    </div>
  )
}

export function SessionSummary({
  s,
  showWriting,
}: {
  s: ReviewSessionResult
  showWriting?: boolean
}) {
  const { t } = useI18n()
  const nav = useContext(ReviewNavigationContext)
  const errors = s.results.filter((r) => r.quality <= 2)
  const difficult = s.results.filter((r) => r.quality === 3)
  const practiceIds = s.results.filter((r) => r.quality < 4).map((r) => r.item.review_item_id)
  return (
    <>
      <h2 className="text-lg font-medium">{t('Session complete')}</h2>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-left">
        {[
          [t('Answers saved'), s.results.length],
          [t('Skipped'), s.skipped],
          [t('Unanswered'), s.remaining],
          [t('Mistakes'), errors.length],
          [t('With difficulty'), difficult.length],
          [t('Moved to known'), s.results.filter((r) => r.response.new_status === 'known').length],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{count}</dd>
          </div>
        ))}
      </dl>
      {s.answerError && (
        <p role="alert" className="mt-4 text-destructive">
          {t('The last attempt is unconfirmed and is not included in these results.')}
        </p>
      )}
      {s.results.some((r) => r.quality < 4) && (
        <ul className="mt-4 space-y-2 text-left text-sm">
          {s.results
            .filter((r) => r.quality < 4)
            .map((r) => (
              <li key={r.item.review_item_id}>
                <span className="font-medium">{r.item.text}</span> —{' '}
                {r.item.translation !== null && (
                  <ForeignLanguageFlag code={r.item.translation_language_code} className="mr-1" />
                )}
                {r.item.translation ?? '—'}{' '}
                <span className="text-muted-foreground">
                  · {t(r.quality <= 2 ? msg('Mistake') : msg('With difficulty'))}
                </span>
              </li>
            ))}
        </ul>
      )}
      {(errors.length > 0 || s.retryRemaining > 0) && (
        <button
          type="button"
          className="mt-5 min-h-11 w-full rounded-md border border-border px-3 py-2 hover:bg-accent"
          onClick={s.restart}
        >
          {t('Review mistakes')} ({Math.min(100, errors.length + s.retryRemaining)})
        </button>
      )}
      {errors.length + s.retryRemaining > 100 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('The remaining mistakes are available in the next session.')}
        </p>
      )}
      {showWriting && practiceIds.length > 0 && nav && (
        <button
          type="button"
          className="mt-3 min-h-11 w-full underline"
          onClick={() => nav.practice(practiceIds.slice(0, 20))}
        >
          {t('Practise difficult words')} ({Math.min(20, practiceIds.length)} / {practiceIds.length}
          )
        </button>
      )}
      {s.graduated && <GraduationToast onDismiss={s.dismissGraduation} />}
    </>
  )
}

function SelectedPractice({ ids }: { ids: string[] | undefined }) {
  const nav = useContext(ReviewNavigationContext)
  const t = useTranslation()
  return ids?.length && nav ? (
    <button
      type="button"
      className="mt-4 min-h-11 underline"
      onClick={() => nav.practice(ids.slice(0, 20))}
    >
      {t('Practise difficult words')} ({Math.min(20, ids.length)})
    </button>
  ) : null
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
      <p className="text-lg font-medium">{t('No vocabulary from this lesson yet')}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          'Words and phrases you add in this lesson will appear here. Words added earlier are available in the general review.',
        )}
      </p>
      {lang && (
        <Link
          to="/learn/$lang/review"
          params={{ lang }}
          search={{}}
          className="mt-3 inline-block underline"
        >
          {t('Review all vocabulary')}
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
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <div
          role="status"
          className="min-h-56 animate-pulse rounded-lg border border-border bg-muted/30 p-6"
        >
          {t('Loading…')}
        </div>
      </SessionShell>
    )
  }
  if (s.status === 'error') {
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <p className="text-destructive">{t('Could not load the review queue')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void s.retryQueue()}>
          {t('Retry')}
        </button>
      </SessionShell>
    )
  }
  if (s.status === 'limit') {
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <p className="text-lg font-medium">{t('Daily limit reached')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Today: {{done}} / {{limit}}. Come back tomorrow!', {
            done: s.daily?.done_today ?? 0,
            limit: s.daily?.limit ?? 0,
          })}
        </p>
        <SelectedPractice ids={s.selectedIds} />
      </SessionShell>
    )
  }
  if (s.status === 'empty') {
    if (s.selectionSize !== undefined)
      return (
        <SessionShell subtitle={subtitle} session={s}>
          <p>{t('These mistakes are no longer available for review.')}</p>
        </SessionShell>
      )
    if (opts?.lessonId) {
      return (
        <SessionShell subtitle={subtitle} session={s}>
          <LessonEmptyState lang={opts.lang} />
        </SessionShell>
      )
    }
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <p className="text-lg font-medium">{t('All caught up')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('No cards due for review.')}</p>
      </SessionShell>
    )
  }
  if (s.status === 'done') {
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <SessionSummary s={s} showWriting={opts?.showWriting} />
      </SessionShell>
    )
  }
  return null
}
