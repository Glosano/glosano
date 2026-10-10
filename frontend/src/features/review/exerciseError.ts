import { ApiError } from '@/api/client'

export function exerciseErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.detail === 'ai_disabled') return 'AI отключён'
  if (error instanceof ApiError && error.status === 404)
    return 'Слово больше не доступно. Пропустите задание.'
  return 'Не удалось сгенерировать упражнение'
}
