import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import { useCallback } from 'react'

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

type TranscriptMessageProps = Pick<
  ChatTranscriptProps,
  'conversationId' | 'renderExercise' | 'renderText' | 'renderMessageMeta'
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
  status,
  t,
}: TranscriptMessageProps) {
  return (
    <MessagePrimitive.Root asChild>
      <article
        data-message-role={role}
        className="mb-4 min-w-0 space-y-2 rounded-xl border border-border p-4"
      >
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
        {status?.type === 'running' ? (
          <span aria-label={t('Ответ формируется')}>{t('Формируем ответ…')}</span>
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
