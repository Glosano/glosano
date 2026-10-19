import { ignoreReviewKey } from './keyboard'
import { useTranslation, useI18n, msg } from '@/lib/i18n'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { reviewApi } from '@/api/review'
import { FillBlankSession } from './FillBlankSession'
import { ReviewNavigationContext } from './reviewNavigation'

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
  from?: 'completion'
}

export function ReviewPage(props: Props) {
  const { language } = useI18n()
  const translationLanguage = useTranslationLanguage()
  return (
    <ReviewPageContent
      key={`${language}:${translationLanguage}:${props.lang}:${props.lessonId ?? ''}:${props.itemKind ?? ''}`}
      {...props}
    />
  )
}

function ReviewPageContent({ lang, lessonId, mode, itemKind, from }: Props) {
  const { language, t } = useI18n()
  const translationLanguage = useTranslationLanguage()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [practiceIds, setPracticeIds] = useState<string[] | undefined>()
  const counts = useQuery({
    queryKey: ['review-counts', lang, lessonId ?? null, itemKind ?? null],
    queryFn: () => reviewApi.counts(lang, lessonId, itemKind),
    enabled: !!mode,
  })
  useEffect(() => {
    if (mode !== 'fill') setPracticeIds(undefined)
  }, [mode])
  const search = {
    ...(lessonId ? { lessonId } : {}),
    ...(itemKind ? { kind: itemKind } : {}),
    ...(from ? { from } : {}),
  }
  const scope = { lang, lessonId, itemKind }
  const titles = {
    cards: msg('Flashcards'),
    new: msg('New words'),
    cloze: msg('Quiz: fill the gap'),
    reverse: msg('Quiz: translation'),
    translation: msg('Translation practice'),
    fill: msg('Fill in the word'),
  }
  let content
  if (!mode) content = <ModeSelect {...scope} from={from} />
  else if (mode !== 'cards' && counts.data?.ai_enabled === false)
    content = (
      <SessionShell subtitle={t(titles[mode])}>
        <p>{t('AI is disabled')}</p>
        <button
          type="button"
          className="mt-4 min-h-11 underline"
          onClick={() =>
            void navigate({
              to: '/learn/$lang/review',
              params: { lang },
              search: { ...search, mode: 'cards' },
            })
          }
        >
          {t('Open flashcards')}
        </button>
      </SessionShell>
    )
  else if (mode === 'cards')
    content = (
      <CardsSession
        key={`${language}:${translationLanguage}:${lang}:${lessonId ?? ''}:${itemKind ?? ''}`}
        {...scope}
      />
    )
  else if (mode === 'new') content = <NewWordsSession {...scope} />
  else if (mode === 'cloze' || mode === 'reverse')
    content = <QuizSession key={mode} kind={mode} {...scope} />
  else if (mode === 'fill') content = <FillBlankSession {...scope} ids={practiceIds} />
  else content = <TranslationSession {...scope} />
  return (
    <ReviewNavigationContext.Provider
      value={{
        lessonTitle: counts.data?.lesson_title,
        choose: () => {
          setPracticeIds(undefined)
          void navigate({ to: '/learn/$lang/review', params: { lang }, search })
        },
        practice: (ids) => {
          setPracticeIds(ids)
          void navigate({
            to: '/learn/$lang/review',
            params: { lang },
            search: { ...search, mode: 'fill' },
          })
        },
        returnToLesson: lessonId
          ? () => {
              void client
                .invalidateQueries({ queryKey: ['lesson', lessonId] })
                .then(() =>
                  navigate({
                    to: '/learn/$lang/lessons/$lessonId',
                    params: { lang, lessonId },
                    search: {},
                  }),
                )
            }
          : undefined,
      }}
    >
      {content}
    </ReviewNavigationContext.Provider>
  )
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
  }, [idx, s.sessionKey])

  // хоткеи: Space — flip, 0..5 — оценка (после переворота)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreReviewKey(e)) return
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

  const subtitle = sessionSubtitle(t, { title: msg('Flashcards'), lessonId, itemKind })
  const states = SessionStates(s, subtitle, { lessonId, lang })
  if (states) return states
  if (!current) return <SessionShell subtitle={subtitle}>{t('Loading…')}</SessionShell>

  return (
    <SessionShell subtitle={subtitle} idx={idx} total={total} session={s}>
      <ReviewCard
        item={current}
        flipped={flipped}
        error={answerError}
        onFlip={() => setFlipped(true)}
      />
      <button
        type="button"
        className="mt-3 min-h-11 underline"
        disabled={answering}
        onClick={s.skip}
      >
        {t('Skip')}
      </button>
      {flipped && <GradeBar onGrade={grade} disabled={answering} />}
      {graduated && <GraduationToast onDismiss={dismissGraduation} />}
    </SessionShell>
  )
}
