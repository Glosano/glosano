import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { ReviewMode } from '@/api/review'
import { GradeBar } from './GradeBar'
import { ModeSelect } from './ModeSelect'
import { NewWordsSession } from './NewWordsSession'
import { QuizSession } from './QuizSession'
import { ReviewCard } from './ReviewCard'
import { GraduationToast, SessionShell, SessionStates } from './sessionUi'
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
  if (mode === 'new') return <NewWordsSession lang={lang} />
  if (mode === 'cloze') return <QuizSession lang={lang} kind="cloze" />
  if (mode === 'reverse') return <QuizSession lang={lang} kind="reverse" />
  // Task 12 заменяет эту заглушку на настоящую сессию
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
  const s = useReviewSession(lang, { serverMode: 'due', lessonId })
  const { current, idx, total, answering, answerError, graduated, dismissGraduation, grade } = s

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

  const subtitle = lessonId ? 'Слова урока' : undefined
  const states = SessionStates(s, subtitle, { lessonId })
  if (states) return states
  if (!current) return <SessionShell subtitle={subtitle}>Загрузка…</SessionShell>

  return (
    <SessionShell subtitle={subtitle} idx={idx} total={total}>
      <ReviewCard item={current} flipped={flipped} error={answerError} onFlip={() => setFlipped(true)} />
      {flipped && <GradeBar onGrade={grade} disabled={answering} />}
      {graduated && <GraduationToast onDismiss={dismissGraduation} />}
    </SessionShell>
  )
}
