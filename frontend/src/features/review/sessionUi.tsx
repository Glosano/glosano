import { useTranslation, useI18n, translate } from '@/lib/i18n'
import { translationLanguageFlag } from '@/lib/languages'
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
        <h1 className="text-xl font-semibold">{t('Повторение')}</h1>
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
            {t('Завершить занятие')}
          </button>
          {nav && (
            <button
              type="button"
              disabled={disabled}
              className="min-h-11 underline disabled:opacity-50"
              onClick={nav.choose}
            >
              {t('Выбрать занятие')}
            </button>
          )}
          {nav?.returnToLesson && (
            <button
              type="button"
              disabled={disabled}
              className="col-span-2 min-h-11 underline disabled:opacity-50"
              onClick={nav.returnToLesson}
            >
              {t('К итогам материала')}
            </button>
          )}
        </div>
      </header>
      {session?.selectionSize !== undefined && session.status === 'active' && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('Ошибки предыдущего занятия: доступно {{count}} из {{total}}.', {
            count: session.total,
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
        {t('Слово выучено ✓')}
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
      <h2 className="text-lg font-medium">{t('Сессия завершена')}</h2>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-left">
        {[
          [t('Ответов сохранено'), s.results.length],
          [t('Пропущено'), s.skipped],
          [t('Осталось без ответа'), s.remaining],
          [t('Ошибки'), errors.length],
          [t('С трудом'), difficult.length],
          [
            t('Перешло в известные'),
            s.results.filter((r) => r.response.new_status === 'known').length,
          ],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-border p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{count}</dd>
          </div>
        ))}
      </dl>
      {s.answerError && (
        <p role="alert" className="mt-4 text-destructive">
          {t('Последняя попытка не подтверждена и не включена в итоги.')}
        </p>
      )}
      {s.results.some((r) => r.quality < 4) && (
        <ul className="mt-4 space-y-2 text-left text-sm">
          {s.results
            .filter((r) => r.quality < 4)
            .map((r) => (
              <li key={r.item.review_item_id}>
                <span className="font-medium">{r.item.text}</span> —{' '}
                {r.item.translation !== null && r.item.translation_language_code !== null && (
                  <span aria-hidden="true" className="mr-1">
                    {translationLanguageFlag(r.item.translation_language_code)}
                  </span>
                )}
                {r.item.translation ?? '—'}{' '}
                <span className="text-muted-foreground">
                  · {t(r.quality <= 2 ? 'Ошибка' : 'С трудом')}
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
          {t('Повторить ошибки')} ({Math.min(100, errors.length + s.retryRemaining)})
        </button>
      )}
      {errors.length + s.retryRemaining > 100 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('Остальные ошибки доступны в следующем занятии.')}
        </p>
      )}
      {showWriting && practiceIds.length > 0 && nav && (
        <button
          type="button"
          className="mt-3 min-h-11 w-full underline"
          onClick={() => nav.practice(practiceIds.slice(0, 20))}
        >
          {t('Закрепить трудные слова')} ({Math.min(20, practiceIds.length)} / {practiceIds.length})
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
      {t('Закрепить трудные слова')} ({Math.min(20, ids.length)})
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
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <div
          role="status"
          className="min-h-56 animate-pulse rounded-lg border border-border bg-muted/30 p-6"
        >
          {t('Загрузка…')}
        </div>
      </SessionShell>
    )
  }
  if (s.status === 'error') {
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <p className="text-destructive">{t('Не удалось загрузить очередь')}</p>
        <button type="button" className="mt-2 underline" onClick={() => void s.retryQueue()}>
          {t('Повторить')}
        </button>
      </SessionShell>
    )
  }
  if (s.status === 'limit') {
    return (
      <SessionShell subtitle={subtitle} session={s}>
        <p className="text-lg font-medium">{t('Дневной лимит достигнут')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Сегодня: {{done}} / {{limit}}. Возвращайтесь завтра!', {
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
          <p>{t('Выбранные ошибки больше не доступны для повторения.')}</p>
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
        <p className="text-lg font-medium">{t('Всё повторено')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('Нет карточек к повторению.')}</p>
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
