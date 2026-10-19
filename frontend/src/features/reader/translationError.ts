import { ApiError } from '@/api/client'
import { translate } from '@/lib/i18n'

export function translationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return translate('AI has been disabled by the administrator')
  }
  return translate('Could not translate')
}
