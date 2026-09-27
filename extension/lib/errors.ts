import { t, type MessageKey } from './i18n'

export type ImportErrorCode =
  | 'unconfigured'
  | 'no_permission'
  | 'unreachable'
  | 'signed_out'
  | 'needs_onboarding'
  | 'validation'
  | 'conflict'
  | 'queue_unavailable'
  | 'restricted_page'
  | 'empty_text'
  | 'too_large'
  | 'unknown'

export interface ImportError {
  code: ImportErrorCode
  detail?: string
}

export class GlosanoError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }

  toJSON(): ImportError {
    return this.detail === undefined ? { code: this.code } : { code: this.code, detail: this.detail }
  }
}

const ERROR_KEYS: Record<ImportErrorCode, MessageKey> = {
  unconfigured: 'error_unconfigured',
  no_permission: 'error_no_permission',
  unreachable: 'error_unreachable',
  signed_out: 'error_signed_out',
  needs_onboarding: 'error_needs_onboarding',
  validation: 'error_validation',
  conflict: 'error_conflict',
  queue_unavailable: 'error_queue_unavailable',
  restricted_page: 'error_restricted_page',
  empty_text: 'error_empty_text',
  too_large: 'error_too_large',
  unknown: 'error_unknown',
}

export function errorMessage(error: ImportError): string {
  return t(ERROR_KEYS[error.code], error.detail ?? '')
}
