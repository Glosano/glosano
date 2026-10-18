import { exerciseErrorKey } from './exerciseError'
import { ignoreReviewKey } from './keyboard'
import { useI18n } from '@/lib/i18n'
import { ForeignLanguageFlag } from '@/components/ForeignLanguageFlag'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { reviewApi, type ExampleExercise, type ReviewItemKind } from '@/api/review'
import { GradeBar } from './GradeBar'
import { HighlightedExample } from './HighlightedExample'
import { useReviewSession } from './useReviewSession'
import { SessionShell, SessionStates } from './sessionUi'
import { sessionSubtitle } from './sessionSubtitle'

interface NewWordsSessionProps {
  lang: string
  lessonId?: string
  itemKind?: ReviewItemKind
}

export function NewWordsSession(props: NewWordsSessionProps) {
  const { language } = useI18n()
  const translationLanguage = useTranslationLanguage()
  return (
    <NewWordsSessionContent
      key={`${language}:${translationLanguage}:${props.lang}:${props.lessonId ?? ''}:${props.itemKind ?? ''}`}
      {...props}
    />
  )
}

function NewWordsSessionContent({ lang, lessonId, itemKind }: NewWordsSessionProps) {
  const { language, t } = useI18n()
  const translationLanguage = useTranslationLanguage()
  const s = useReviewSession(lang, { serverMode: 'new', lessonId, itemKind })
  const [revealed, setRevealed] = useState(false)

  const exercise = useQuery({
    queryKey: [
      'exercise',
      s.sessionKey,
      language,
      translationLanguage,
      'example',
      s.current?.review_item_id ?? null,
    ],
    queryFn: () =>
      reviewApi.exercise<ExampleExercise>({
        kind: 'example',
        review_item_id: s.current!.review_item_id,
      }),
    enabled: s.current !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

  useEffect(() => setRevealed(false), [s.current?.review_item_id, s.sessionKey])

  // хоткеи: Space — раскрыть; 0..5 — оценка после раскрытия
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreReviewKey(e)) return
      if (!s.current || !exercise.data) return
      if (e.key === ' ') {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && /^[0-5]$/.test(e.key)) {
        s.grade(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const subtitle = sessionSubtitle(t, { title: 'Новые слова', lessonId, itemKind })

  const states = SessionStates(s, subtitle, { lessonId, lang })
  if (states) return states
  const item = s.current!

  return (
    <SessionShell subtitle={subtitle} idx={s.idx} total={s.total} session={s}>
      <div className="min-h-56 w-full rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
        <p className="mb-3 text-xs text-muted-foreground">{t('AI-пример')}</p>
        <p className="text-center text-2xl font-medium">{item.text}</p>
        {exercise.isPending && (
          <p className="mt-4 text-center text-sm text-muted-foreground">{t('Готовим пример…')}</p>
        )}
        {exercise.isError && (
          <div className="mt-4 text-center">
            <p className="text-sm text-destructive">{t(exerciseErrorKey(exercise.error))}</p>
            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="underline" onClick={() => void exercise.refetch()}>
                {t('Повторить')}
              </button>
              <button type="button" className="underline" onClick={s.skip}>
                {t('Пропустить')}
              </button>
            </div>
          </div>
        )}
        {exercise.data && (
          <>
            <p className="mt-3 text-center text-base">
              <HighlightedExample
                sentence={exercise.data.payload.sentence}
                word={item.text}
                lang={lang}
              />
            </p>
            {!revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-6 w-full rounded-md border border-border py-3 text-sm hover:bg-accent"
              >
                {t('Показать перевод')}
              </button>
            ) : (
              <>
                <hr className="my-4 border-border" />
                <p className="text-xs text-muted-foreground">{t('Ваш перевод')}</p>
                <p className="text-center text-xl">
                  {item.translation !== null && (
                    <ForeignLanguageFlag code={item.translation_language_code} className="mr-2" />
                  )}
                  {item.translation ?? t('Перевод не сохранён')}
                </p>
                {exercise.data.payload.base_form.normalize('NFC').toLowerCase() !==
                  item.text.normalize('NFC').toLowerCase() && (
                  <p className="mt-2 text-center text-sm text-muted-foreground">
                    {exercise.data.payload.base_form} →{' '}
                    {exercise.data.payload.base_form_translation}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">{t('AI-перевод примера')}</p>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  {exercise.data.payload.sentence_translation}
                </p>
                {s.answerError && (
                  <p className="mt-2 text-center text-sm text-destructive">{s.answerError}</p>
                )}
                <GradeBar onGrade={s.grade} disabled={s.answering} />
              </>
            )}
          </>
        )}
      </div>
    </SessionShell>
  )
}
