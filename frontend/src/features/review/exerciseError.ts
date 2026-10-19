import { ApiError } from '@/api/client'
import { msg } from '@/lib/i18n'

export function exerciseErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.detail === 'ai_disabled') return msg('AI is disabled')
  if (error instanceof ApiError && error.status === 404)
    return msg('This item is no longer available. Skip this exercise.')
  return msg('Could not generate the exercise')
}
