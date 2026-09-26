import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import type { ReactNode } from 'react'

import type { AppendMessage, MessageStatus, ThreadMessageLike } from '@assistant-ui/react'

import { useTranslation } from '@/lib/i18n'

import type { Translator } from '@/lib/i18n'

import type {
  ChatTranscriptExercisePart,
  ChatTranscriptMessage,
  ChatTranscriptProps,
} from './transcript'

const messageStatus = (message: ChatTranscriptMessage): MessageStatus => {
  switch (message.state) {
    case 'pending':
      return { type: 'running' }
    case 'error':
      return { type: 'incomplete', reason: 'error', error: message.error }
    case 'cancelled':
      return { type: 'incomplete', reason: 'cancelled' }
    case 'complete':
      return { type: 'complete', reason: 'stop' }
  }
}

const convertMessage = (message: ChatTranscriptMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: message.parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'data-exercise' as const, data: part },
  ),
  createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
  ...(message.role === 'assistant' ? { status: messageStatus(message) } : {}),
})

const appendedText = (message: AppendMessage): string =>
  message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()

/**
 * Folds a long user message to about eight lines behind «Показать ещё», as chat
 * apps do (FLQ-32.9). Overflow is measured, not guessed from text length, so
 * quotes and wrapped lines count the same way they render.
 */
function CollapsibleBody({ children, t }: { children: ReactNode; t: Translator }) {
  const body = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const node = body.current
    if (!node || expanded) return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
    measure()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    return () => observer.disconnect()
  })
  const folded = overflowing && !expanded
  return (
    <>
      <div
        ref={body}
        className={`space-y-2 ${
          expanded
            ? ''
            : 'max-h-52 overflow-hidden' +
              (folded ? ' [mask-image:linear-gradient(to_bottom,black_70%,transparent)]' : '')
        }`}
      >
        {children}
      </div>
      {overflowing && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {t(expanded ? 'Свернуть' : 'Показать ещё')}
          <ChevronDown
            aria-hidden="true"
            className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </>
  )
}

type TranscriptMessageProps = Pick<
  ChatTranscriptProps,
  'conversationId' | 'renderExercise' | 'renderText' | 'renderMessageMeta' | 'renderMessageActions'
> &
  Readonly<{
    messageId: string
    role: string
    status?: MessageStatus
    t: Translator
  }>

function TranscriptMessage({
  conversationId,
  messageId,
  role,
  renderExercise,
  renderText,
  renderMessageMeta,
  renderMessageActions,
  status,
  t,
}: TranscriptMessageProps) {
  const user = role === 'user'
  const body = (
    <>
      {renderMessageMeta?.(messageId)}
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type === 'text') {
            return renderText ? renderText(part.text) : <p>{part.text}</p>
          }
          if (part.type !== 'data' || part.name !== 'exercise') {
            return null
          }

          const exercise = part.data as ChatTranscriptExercisePart
          return renderExercise ? (
            renderExercise({
              conversationId,
              messageId,
              exercise,
            })
          ) : (
            <section
              aria-label={t('Упражнение {{id}}', { id: exercise.exerciseId })}
              data-exercise-id={exercise.exerciseId}
            >
              {exercise.prompt}
            </section>
          )
        }}
      </MessagePrimitive.Parts>
    </>
  )
  return (
    // Chat-app layout (FLQ-32.8): the user's turn is a bubble on the right, the
    // reply is plain full-width text; actions sit below, outside the bubble.
    <div className={`group mb-6 flex min-w-0 flex-col ${user ? 'items-end' : 'items-stretch'}`}>
      <MessagePrimitive.Root asChild>
        <article
          data-message-role={role}
          className={
            user
              ? 'max-w-[85%] min-w-0 space-y-2 rounded-3xl bg-muted px-4 py-2.5 @lg:max-w-[70%]'
              : 'min-w-0 space-y-2'
          }
        >
          {user ? <CollapsibleBody t={t}>{body}</CollapsibleBody> : body}
          {status?.type === 'running' ? (
            <span
              aria-label={t('Ответ формируется')}
              className="block animate-pulse text-sm text-muted-foreground"
            >
              {t('Формируем ответ…')}
            </span>
          ) : null}
          {status?.type === 'incomplete' && status.reason === 'cancelled' ? (
            <span aria-label={t('Ответ остановлен')}>{t('Ответ остановлен')}</span>
          ) : null}
          {status?.type === 'incomplete' && status.reason === 'error' ? (
            <p role="alert">
              {typeof status.error === 'string' ? status.error : t('Не удалось получить ответ')}
            </p>
          ) : null}
        </article>
      </MessagePrimitive.Root>
      {renderMessageActions?.(messageId)}
    </div>
  )
}

function ChatTranscriptRuntime({
  conversationId,
  messages,
  readOnly = false,
  showComposer = true,
  onSend,
  onCancel,
  renderExercise,
  renderText,
  renderMessageMeta,
  renderMessageActions,
}: ChatTranscriptProps) {
  const t = useTranslation()
  const handleNew = useCallback(
    async (message: AppendMessage) => {
      const text = appendedText(message)
      if (text && onSend) await onSend(conversationId, text)
    },
    [conversationId, onSend],
  )
  const handleCancel = useCallback(async () => {
    if (!readOnly) await onCancel?.(conversationId)
  }, [conversationId, onCancel, readOnly])
  const canCancel = !readOnly && Boolean(onCancel)

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isDisabled: readOnly || !onSend,
    isRunning: messages.some((message) => message.state === 'pending'),
    onNew: handleNew,
    onCancel: canCancel ? handleCancel : undefined,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <div role="log" aria-label={t('История чата')}>
          <ThreadPrimitive.Messages>
            {({ message }) => (
              <TranscriptMessage
                conversationId={conversationId}
                messageId={message.id}
                role={message.role}
                renderExercise={renderExercise}
                renderText={renderText}
                renderMessageMeta={renderMessageMeta}
                renderMessageActions={renderMessageActions}
                status={message.status}
                t={t}
              />
            )}
          </ThreadPrimitive.Messages>
        </div>
        {showComposer && (
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input aria-label={t('Сообщение')} />
            <ComposerPrimitive.Send aria-label={t('Отправить сообщение')}>
              {t('Отправить')}
            </ComposerPrimitive.Send>
            {canCancel ? (
              <ComposerPrimitive.Cancel aria-label={t('Остановить ответ')}>
                {t('Остановить')}
              </ComposerPrimitive.Cancel>
            ) : null}
          </ComposerPrimitive.Root>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

export function ChatTranscript(props: ChatTranscriptProps) {
  return <ChatTranscriptRuntime key={props.conversationId} {...props} />
}
