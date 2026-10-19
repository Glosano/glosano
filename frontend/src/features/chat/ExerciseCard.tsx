import { useId, useState } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { chatsApi, type Exercise, type Attempt } from '@/api/chats'
import { Button } from '@/components/ui/button'
import { intlLocale, useI18n, msg } from '@/lib/i18n'
import { chatDrafts, useChatStore, MAX_UNFINISHED_ANSWERS } from './chatStore'
import { ChatCitation } from './ChatCitation'
import { useDraft } from './useChat'

export function ExerciseCard({
  exercise,
  aiEnabled,
  busy,
}: {
  exercise: Exercise
  aiEnabled: boolean
  busy: boolean
}) {
  const { language, t } = useI18n(),
    uid = useChatStore((s) => s.userId),
    client = useQueryClient(),
    formId = useId()
  const cid = exercise.conversation_id,
    entry = useDraft(cid),
    answer = entry.draft.answers[exercise.id] ?? ''
  const [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(false)
  const atAnswerLimit =
    !answer &&
    Object.values(entry.draft.answers).filter((value) => value !== '').length >=
      MAX_UNFINISHED_ANSWERS
  const [confirmSimilar, setConfirmSimilar] = useState(false)
  const operationKey = `attempt:${exercise.id}`
  const pending = useChatStore((s) => s.operations[operationKey])
  const attempts = useInfiniteQuery({
    queryKey: ['chats', uid, 'attempts', exercise.id],
    queryFn: ({ pageParam }) => chatsApi.attempts(cid, exercise.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) =>
      last.items.length === 50 ? all.reduce((n, p) => n + p.items.length, 0) : undefined,
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) => p.items.some((a) => a.status === 'pending')) ? 1500 : false,
  })
  const history = [
    ...new Map((attempts.data?.pages.flatMap((p) => p.items) ?? []).map((a) => [a.id, a])).values(),
  ]
  function edit(value: string) {
    chatDrafts.editAnswer(cid, exercise.id, value)
  }
  async function submit() {
    if (!entry.loaded || submitting) return
    const captured = chatDrafts.operation(operationKey, answer)
    setSubmitting(true)
    setError(false)
    try {
      if (useChatStore.getState().userId !== uid) return
      const attempt = await chatsApi.attempt(cid, exercise.id, captured.answer, captured.id)
      if (useChatStore.getState().userId !== uid) return
      chatDrafts.retireAnswer(cid, exercise.id, captured.answer)
      if (exercise.kind === 'free_response') {
        const evalKey = `evaluate:${attempt.id}`
        const evaluation = chatDrafts.operation(evalKey)
        await chatsApi.evaluate(cid, attempt.id, evaluation.id)
        if (useChatStore.getState().userId !== uid) return
        chatDrafts.finishOperation(evalKey)
      }
      chatDrafts.finishOperation(operationKey)
      await client.cancelQueries({ queryKey: ['chats', uid, 'attempts', exercise.id] })
      client.setQueryData<InfiniteData<{ items: Attempt[] }>>(
        ['chats', uid, 'attempts', exercise.id],
        (old) => ({
          pageParams: old?.pageParams ?? [0],
          pages: old?.pages.length
            ? old.pages.map((p, i) =>
                i === 0 ? { items: [attempt, ...p.items.filter((a) => a.id !== attempt.id)] } : p,
              )
            : [{ items: [attempt] }],
        }),
      )
      await client.invalidateQueries({ queryKey: ['chats', uid] })
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }
  function reference(attemptId: string | null) {
    chatDrafts.edit(cid, { exercise_id: exercise.id, attempt_id: attemptId })
    document.querySelector<HTMLTextAreaElement>('[data-chat-composer] textarea')?.focus()
  }
  function similar() {
    const draft = chatDrafts.get(cid).draft
    if (draft.text.trim() || draft.citation_ids.length || draft.exercise_id || draft.attempt_id)
      setConfirmSimilar(true)
    else void queueSimilar()
  }
  async function queueSimilar() {
    setConfirmSimilar(false)
    setError(false)
    try {
      reference(null)
      await chatDrafts.send(cid, '', 'exercise', exercise.kind)
      if (useChatStore.getState().userId === uid)
        await client.invalidateQueries({ queryKey: ['chats', uid] })
    } catch {
      setError(true)
    }
  }
  return (
    <section
      aria-label={t('Exercise {{id}}', { id: exercise.id })}
      className="my-3 space-y-3 rounded-xl border border-primary/30 bg-background p-4"
    >
      <div className="text-xs font-medium text-muted-foreground">
        {t('Exercise · AI-generated')}
      </div>
      <p className="whitespace-pre-wrap font-medium">
        {exercise.kind === 'gap' ? exercise.prompt.replace('{{gap}}', '_____') : exercise.prompt}
      </p>
      {exercise.goal && <p className="text-sm text-muted-foreground">{exercise.goal}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-3"
      >
        {exercise.kind === 'single_choice' ? (
          <fieldset disabled={!entry.loaded || submitting || atAnswerLimit} className="space-y-2">
            <legend className="sr-only">{t('Choose an answer')}</legend>
            {exercise.options?.map((option) => (
              <label
                className="flex cursor-pointer items-start gap-2 rounded border p-3"
                key={option.id}
              >
                <input
                  className="mt-1"
                  type="radio"
                  name={formId}
                  value={option.id}
                  checked={answer === option.id}
                  onChange={() => edit(option.id)}
                />
                <span>{option.text}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="block text-sm">
            {t('Answer')}
            {exercise.kind === 'gap' ? (
              <input
                maxLength={4000}
                className="mt-1 block w-full rounded border bg-background p-2"
                value={answer}
                disabled={!entry.loaded || atAnswerLimit}
                onChange={(e) => edit(e.target.value)}
              />
            ) : (
              <textarea
                maxLength={4000}
                rows={3}
                className="mt-1 block w-full rounded border bg-background p-2"
                value={answer}
                disabled={!entry.loaded || atAnswerLimit}
                onChange={(e) => edit(e.target.value)}
              />
            )}
          </label>
        )}
        <Button
          type="submit"
          disabled={
            !entry.loaded ||
            (!answer.trim() && !pending) ||
            submitting ||
            (exercise.kind === 'free_response' && (!aiEnabled || busy))
          }
        >
          {t(pending ? msg('Retry answer submission') : msg('Check answer'))}
        </Button>
        {answer !== '' && (
          <Button type="button" variant="outline" onClick={() => edit('')}>
            {t('Clear answer draft')}
          </Button>
        )}
      </form>
      {atAnswerLimit && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            'You have 30 unfinished answers. Submit or clear an existing answer to start another.',
          )}
        </p>
      )}
      {exercise.kind === 'free_response' && !aiEnabled && (
        <p className="text-sm text-muted-foreground">
          {t('AI evaluation is unavailable. Your answer is saved as a draft.')}
        </p>
      )}
      {error && (
        <p role="alert">{t('Could not submit your answer. Retry; your attempt is preserved.')}</p>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <button
          disabled={
            !aiEnabled ||
            busy ||
            submitting ||
            !entry.loaded ||
            entry.sending ||
            !!entry.pending ||
            !!entry.conflict
          }
          className="underline disabled:opacity-50"
          onClick={() => void similar()}
        >
          {t('Similar exercise')}
        </button>
        <button className="underline" onClick={() => reference(null)}>
          {t('Discuss exercise')}
        </button>
      </div>
      {confirmSimilar && (
        <div className="space-y-2 rounded border border-amber-500 p-3 text-sm" role="alert">
          <p>{t('Your current draft will be sent with the similar exercise request.')}</p>
          <p className="whitespace-pre-wrap break-words">{entry.draft.text}</p>
          {entry.draft.citation_ids.map((id) => (
            <ChatCitation key={id} id={id} />
          ))}
          <p>
            {t('Exercise for the new request')}: {exercise.prompt.replace('{{gap}}', '_____')}
          </p>
          {(entry.draft.exercise_id || entry.draft.attempt_id) && (
            <p>{t('The previous exercise or attempt reference will be replaced.')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setConfirmSimilar(false)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!aiEnabled || busy || entry.sending || !!entry.pending || !!entry.conflict}
              onClick={() => void queueSimilar()}
            >
              {t('Send draft and create similar')}
            </Button>
          </div>
        </div>
      )}
      {history.length > 0 && <h4 className="text-sm font-semibold">{t('Previous attempts')}</h4>}
      {history.map((attempt) => (
        <article className="space-y-2 rounded border p-3 text-sm" key={attempt.id}>
          <time className="text-xs text-muted-foreground" dateTime={attempt.created_at}>
            {new Date(attempt.created_at).toLocaleString(intlLocale(language))}
          </time>
          <p className="whitespace-pre-wrap break-words">
            {exercise.options?.find((o) => o.id === attempt.answer)?.text ?? attempt.answer}
          </p>
          <p className="font-medium">
            {t(
              attempt.status === 'pending'
                ? msg('Awaiting evaluation')
                : attempt.status === 'failed'
                  ? msg('Not graded — evaluation failed')
                  : attempt.correct
                    ? msg('Correct')
                    : msg('Incorrect'),
            )}
          </p>
          {attempt.feedback && <p className="whitespace-pre-wrap">{attempt.feedback}</p>}
          <button className="underline" onClick={() => reference(attempt.id)}>
            {t('Discuss this attempt')}
          </button>
        </article>
      ))}
      {attempts.isError && (
        <button className="underline" onClick={() => void attempts.refetch()}>
          {t('Retry loading attempts')}
        </button>
      )}
      {attempts.hasNextPage && (
        <Button
          variant="outline"
          disabled={attempts.isFetchingNextPage}
          onClick={() => void attempts.fetchNextPage()}
        >
          {t('More attempts')}
        </Button>
      )}
    </section>
  )
}
