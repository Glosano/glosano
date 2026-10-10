import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reviewApi, type FillBlankExercise, type ReviewItemKind } from '@/api/review'
import { useI18n } from '@/lib/i18n'
import { exerciseErrorKey } from './exerciseError'
import { normalizeFillAnswer } from './fillAnswer'
import { SessionShell } from './sessionUi'
import { sessionSubtitle } from './sessionSubtitle'

interface Props {
  lang: string
  lessonId?: string
  itemKind?: ReviewItemKind
  ids?: string[]
}
interface Attempt {
  correct: boolean
  hinted: boolean
}

export function FillBlankSession({ lang, lessonId, itemKind, ids }: Props) {
  const { language, t } = useI18n()
  const instance = useId()
  const [idx, setIdx] = useState(0)
  const [finished, setFinished] = useState(false)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [skipped, setSkipped] = useState(0)
  const queue = useQuery({
    queryKey: ['review-queue', lang, 'fill', lessonId, itemKind, language, instance, ids],
    queryFn: () =>
      ids
        ? reviewApi.selectedQueue(lang, ids, true, lessonId, itemKind)
        : reviewApi.queue(lang, lessonId, 'fill', itemKind),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const item = finished ? undefined : queue.data?.items[idx]
  const total = queue.data?.items.length ?? 0
  const subtitle = sessionSubtitle(t, { title: 'Вставить слово', lessonId, itemKind })
  const next = () => setIdx((value) => value + 1)
  return (
    <SessionShell
      subtitle={subtitle}
      idx={item ? idx : undefined}
      total={item ? total : undefined}
      finish={item ? () => setFinished(true) : undefined}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {t('Дополнительная практика — без изменения расписания.')}
      </p>
      {queue.isPending ? (
        <p role="status" className="min-h-56">
          {t('Загрузка…')}
        </p>
      ) : queue.isError ? (
        <div>
          <p>{t('Не удалось загрузить очередь')}</p>
          <button type="button" className="min-h-11 underline" onClick={() => void queue.refetch()}>
            {t('Повторить')}
          </button>
        </div>
      ) : total === 0 ? (
        <p>{t('Нет доступных слов для этой практики.')}</p>
      ) : !item ? (
        <>
          <h2 className="text-lg font-medium">{t('Практика завершена')}</h2>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-left">
            {[
              [t('Попыток'), attempts.length],
              [t('Совпадений'), attempts.filter((a) => a.correct).length],
              [t('С подсказкой'), attempts.filter((a) => a.hinted).length],
              [t('Пропущено'), skipped],
              [t('Осталось без ответа'), Math.max(0, total - attempts.length - skipped)],
            ].map(([label, count]) => (
              <div key={label} className="rounded-lg border p-4">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl">{count}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          {ids && (
            <p className="mb-3 text-sm text-muted-foreground">
              {t('Трудные слова: доступно {{count}} из {{total}}.', {
                count: total,
                total: ids.length,
              })}
            </p>
          )}
          <FillCard
            key={item.review_item_id}
            id={item.review_item_id}
            phrase={item.item_kind === 'phrase'}
            onAttempt={(attempt) => setAttempts((all) => [...all, attempt])}
            onNext={next}
            onSkip={() => {
              setSkipped((value) => value + 1)
              next()
            }}
          />
        </>
      )}
    </SessionShell>
  )
}

function FillCard({
  id,
  phrase,
  onAttempt,
  onNext,
  onSkip,
}: {
  id: string
  phrase: boolean
  onAttempt: (attempt: Attempt) => void
  onNext: () => void
  onSkip: () => void
}) {
  const { language, t } = useI18n()
  const instance = useId()
  const [text, setText] = useState('')
  const [hinted, setHinted] = useState(false)
  const [checked, setChecked] = useState(false)
  const [correct, setCorrect] = useState(false)
  const attempted = useRef(false)
  const composing = useRef(false)
  const exercise = useQuery({
    queryKey: ['exercise', language, 'fill_blank', id, instance],
    queryFn: () =>
      reviewApi.exercise<FillBlankExercise>({ kind: 'fill_blank', review_item_id: id }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const payload = exercise.data?.payload
  const check = () => {
    if (!payload || !text.trim() || attempted.current || composing.current) return
    attempted.current = true
    const matches = normalizeFillAnswer(text) === normalizeFillAnswer(payload.answer)
    setCorrect(matches)
    setChecked(true)
    onAttempt({ correct: matches, hinted })
  }
  return (
    <div className="min-h-64 rounded-lg border border-border bg-card p-5 text-left shadow-sm sm:p-6">
      <p className="mb-3 text-xs text-muted-foreground">{t('AI-пример')}</p>
      {exercise.isPending && <p role="status">{t('Готовим упражнение…')}</p>}
      {exercise.isError && (
        <div role="alert">
          <p>{t(exerciseErrorKey(exercise.error))}</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => void exercise.refetch()}
          >
            {t('Повторить')}
          </button>
        </div>
      )}
      {payload && (
        <>
          <p dir="auto" className="text-lg leading-relaxed">
            {payload.before}
            <span className="inline-block min-w-16 border-b-2 border-primary px-1 text-center font-semibold">
              {checked ? payload.answer : '…'}
            </span>
            {payload.after}
          </p>
          {!checked ? (
            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault()
                check()
              }}
            >
              <label className="text-sm" htmlFor={`fill-${instance}`}>
                {t(phrase ? 'Введите фразу целиком' : 'Введите пропущенное слово')}
              </label>
              <input
                id={`fill-${instance}`}
                dir="auto"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={1000}
                onCompositionStart={() => {
                  composing.current = true
                }}
                onCompositionEnd={() => {
                  composing.current = false
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    (e.repeat || e.nativeEvent.isComposing || composing.current)
                  )
                    e.preventDefault()
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="mt-4 min-h-11 w-full rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
              >
                {t('Проверить')}
              </button>
              <button
                type="button"
                className="mt-2 min-h-11 underline"
                onClick={() => setHinted(true)}
                disabled={hinted}
              >
                {t('Подсказка')}
              </button>
            </form>
          ) : (
            <div className="mt-5" role="status">
              <p className="font-medium">
                {t(correct ? 'Верно!' : 'В этом задании изучаем другое слово.')}
              </p>
              {!correct && <p className="mt-2">{t('Ваш ответ: {{answer}}', { answer: text })}</p>}
              <p className="mt-2">{t('Изучаемая форма: {{answer}}', { answer: payload.answer })}</p>
            </div>
          )}
          {(hinted || checked) && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{t('AI-перевод примера')}</p>
              <p dir="auto" className="mt-1">
                {payload.translation}
              </p>
            </div>
          )}
          {checked && (
            <button
              type="button"
              className="mt-5 min-h-11 w-full rounded-md bg-primary px-3 py-2 text-primary-foreground"
              onClick={onNext}
            >
              {t('Дальше')}
            </button>
          )}
        </>
      )}
      {!checked && (
        <button type="button" className="mt-3 min-h-11 underline" onClick={onSkip}>
          {t('Пропустить')}
        </button>
      )}
    </div>
  )
}
