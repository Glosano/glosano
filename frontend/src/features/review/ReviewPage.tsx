import { useTranslation, useI18n } from '@/lib/i18n'
import { useEffect, useState } from 'react'

import type { ReviewItemKind, ReviewMode } from '@/api/review'
import { GradeBar } from './GradeBar'
import { ModeSelect } from './ModeSelect'
import { NewWordsSession } from './NewWordsSession'
import { QuizSession } from './QuizSession'
import { ReviewCard } from './ReviewCard'
import { GraduationToast, SessionShell, SessionStates } from './sessionUi'
import { sessionSubtitle } from './sessionSubtitle'
import { TranslationSession } from './TranslationSession'
import { useReviewSession } from './useReviewSession'

interface Props {
  lang: string
  lessonId: string | undefined
  mode: ReviewMode | undefined
  itemKind?: ReviewItemKind
}

export function ReviewPage({ lang, lessonId, mode, itemKind }: Props) {
  const { language } = useI18n()
  const scope = { lang, lessonId, itemKind }
  if (!mode) return <ModeSelect {...scope} />
  if (mode === 'cards')
    return <CardsSession key={`${language}:${lang}:${lessonId ?? ''}:${itemKind ?? ''}`} {...scope} />
  if (mode === 'new') return <NewWordsSession {...scope} />
  if (mode === 'cloze') return <QuizSession kind="cloze" {...scope} />
  if (mode === 'reverse') return <QuizSession kind="reverse" {...scope} />
  return <TranslationSession {...scope} />
}

function CardsSession({
  lang,
  lessonId,
  itemKind,
}: {
  lang: string
  lessonId: string | undefined
  itemKind: ReviewItemKind | undefined
}) {
  const t = useTranslation()
  const s = useReviewSession(lang, { serverMode: 'due', lessonId, itemKind })
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

  const subtitle = sessionSubtitle(t, { lessonId, itemKind })
  const states = SessionStates(s, subtitle, { lessonId, lang })
  if (states) return states
  if (!current) return <SessionShell subtitle={subtitle}>{t('Загрузка…')}</SessionShell>

  return (
    <SessionShell subtitle={subtitle} idx={idx} total={total}>
      <ReviewCard
        item={current}
        flipped={flipped}
        error={answerError}
        onFlip={() => setFlipped(true)}
      />
      {flipped && <GradeBar onGrade={grade} disabled={answering} />}
      {graduated && <GraduationToast onDismiss={dismissGraduation} />}
    </SessionShell>
  )
}
