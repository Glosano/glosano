import { ApiError } from '@/api/client'
import { translate } from '@/lib/i18n'

export function translationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return translate('AI отключён администратором')
  }
  return translate('Не удалось перевести')
}
