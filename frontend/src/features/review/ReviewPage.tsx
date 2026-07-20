import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { ReviewMode } from '@/api/review'
import { GradeBar } from './GradeBar'
import { ModeSelect } from './ModeSelect'
import { ReviewCard } from './ReviewCard'
import { useReviewSession } from './useReviewSession'

interface Props {
  lang: string
  lessonId: string | undefined
  mode: ReviewMode | undefined
}

export function ReviewPage({ lang, lessonId, mode }: Props) {
  if (lessonId) return <CardsSession lang={lang} lessonId={lessonId} />
  if (!mode) return <ModeSelect lang={lang} />
  if (mode === 'cards') return <CardsSession lang={lang} lessonId={undefined} />
  // Tasks 10-12 заменяют эти заглушки на настоящие сессии
  return <ModePlaceholder lang={lang} />
}

function ModePlaceholder({ lang }: { lang: string }) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p>Режим в разработке</p>
      <button
        type="button"
        className="mt-3 underline"
        onClick={() => void navigate({ to: '/learn/$lang/review', params: { lang }, search: {} })}
      >
        Назад
      </button>
    </div>
  )
}

function CardsSession({ lang, lessonId }: { lang: string; lessonId: string | undefined }) {
  const {
    status,
    daily,
    current,
    idx,
    total,
    results,
    answering,
    answerError,
    graduated,
    dismissGraduation,
    grade,
    restart,
    retryQueue,
  } = useReviewSession(lang, { serverMode: 'due', lessonId })

  const [flipped, setFlipped] = useState(false)

  // Флип сбрасывается при переходе к следующей карточке (idx меняется после grade()).
  useEffect(() => {
    setFlipped(false)
  }, [idx])

  // хоткеи: Space — flip, 0..5 — оценка (после переворота)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (e.key === ' ') {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && /^[0-5]$/.test(e.key)) {
        grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, flipped, grade])

  if (status === 'loading') {
    return <Shell lessonId={lessonId}>Загрузка…</Shell>
  }
  if (status === 'error') {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-destructive">Не удалось загрузить очередь</p>
        <button type="button" className="mt-2 underline" onClick={() => void retryQueue()}>
          Повторить
        </button>
      </Shell>
    )
  }
  if (status === 'limit') {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Дневной лимит достигнут</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Сегодня: {daily?.done_today} / {daily?.limit}. Возвращайтесь завтра!
        </p>
      </Shell>
    )
  }
  if (status === 'empty') {
    return (
      <Shell lessonId={lessonId}>
        <p className="text-lg font-medium">Всё повторено</p>
        <p className="mt-1 text-sm text-muted-foreground">Нет карточек к повторению.</p>
      </Shell>
    )
  }

  if (status === 'done') {
    const avg = results.length > 0 ? results.reduce((sum, r) => sum + r.quality, 0) / results.length : 0
    const toRepeat = results.filter((r) => r.quality < 4)
    return (
      <Shell lessonId={lessonId}>
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
        {graduated && <GraduationToast onDismiss={dismissGraduation} />}
      </Shell>
    )
  }

  // status === 'active' (guaranteed non-empty by useReviewSession)
  if (!current) {
    return <Shell lessonId={lessonId}>Загрузка…</Shell>
  }
  return (
    <Shell lessonId={lessonId}>
      <p className="mb-4 text-sm text-muted-foreground">
        {idx + 1} / {total}
      </p>
      <ReviewCard item={current} flipped={flipped} error={answerError} onFlip={() => setFlipped(true)} />
      {flipped && <GradeBar onGrade={grade} disabled={answering} />}
      {graduated && <GraduationToast onDismiss={dismissGraduation} />}
    </Shell>
  )
}

const GRADUATION_TOAST_MS = 3000

function GraduationToast({ onDismiss }: { onDismiss: () => void }) {
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

function Shell({ lessonId, children }: { lessonId: string | undefined; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-1 text-xl font-semibold">Повторение</h1>
      {lessonId && <p className="mb-4 text-sm text-muted-foreground">Слова урока</p>}
      {children}
    </div>
  )
}
