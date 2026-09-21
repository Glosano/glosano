import { useQuery } from '@tanstack/react-query'
import { chatsApi } from '@/api/chats'
import { useTranslation } from '@/lib/i18n'
import { useChatStore } from './chatStore'

export function ChatReference({
  conversationId,
  exerciseId,
  attemptId,
}: {
  conversationId: string
  exerciseId: string | null
  attemptId: string | null
}) {
  const t = useTranslation(),
    uid = useChatStore((s) => s.userId)
  const query = useQuery({
    queryKey: ['chats', uid, 'reference', conversationId, exerciseId, attemptId],
    enabled: !!uid && !!exerciseId,
    queryFn: async () => {
      const exercise = await chatsApi.exercise(conversationId, exerciseId!)
      if (!attemptId) return { exercise, attempt: null }
      for (let offset = 0; ; offset += 50) {
        if (useChatStore.getState().userId !== uid) throw new Error('Chat identity changed')
        const page = await chatsApi.attempts(conversationId, exerciseId!, offset)
        const attempt = page.items.find((a) => a.id === attemptId)
        if (attempt || page.items.length < 50) return { exercise, attempt: attempt ?? null }
      }
    },
  })
  const exercise = query.data?.exercise,
    attempt = query.data?.attempt
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <strong>{t(attemptId ? 'Обсуждение попытки' : 'Контекст упражнения')}</strong>
      {exercise ? (
        <p className="line-clamp-3 whitespace-pre-wrap break-words">
          {exercise.prompt.replace('{{gap}}', '_____')}
        </p>
      ) : (
        <p>{t(query.isError ? 'Не удалось загрузить упражнение' : 'Загрузка…')}</p>
      )}
      {attempt && (
        <>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">
            {exercise?.options?.find((o) => o.id === attempt.answer)?.text ?? attempt.answer}
          </p>
          <p>
            {t(
              attempt.status === 'pending'
                ? 'Ожидает проверки'
                : attempt.status === 'failed'
                  ? 'Не оценено — проверка не удалась'
                  : attempt.correct
                    ? 'Верно'
                    : 'Неверно',
            )}
          </p>
          {attempt.feedback && <p className="line-clamp-3">{attempt.feedback}</p>}
        </>
      )}
      {query.isError && (
        <button type="button" className="underline" onClick={() => void query.refetch()}>
          {t('Повторить загрузку')}
        </button>
      )}
    </div>
  )
}
