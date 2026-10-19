/**
 * API client with cookie-based session + CSRF (ADR-0008).
 *
 * The backend issues `glosano_session` (HttpOnly) and `glosano_csrf` (readable JS)
 * cookies. For mutating requests we read the CSRF cookie and echo it in the
 * `X-CSRF-Token` header (double-submit pattern).
 */

import { translate, msg } from '@/lib/i18n'

export interface HealthResponse {
  status: string
  version: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly structuredDetail?: unknown,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

export function getApiErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return msg('The request failed. Please try again.')
  const known: Record<string, string> = {
    'Invalid password': msg('Incorrect password.'),
    'Invalid current password': msg('Incorrect password.'),
    'Invalid email or password': msg('Incorrect email or password.'),
    'Email already in use': msg('This email is already in use.'),
    'Registration is disabled': msg('Registration is closed by the administrator.'),
    native_language_is_learning: msg('Your native language cannot be a learning language'),
  }
  const key = known[error.detail]
  if (key) return key
  if (error.status === 401) return msg('Your session expired. Sign in again.')
  if (error.status === 403) return msg('You do not have permission for this action.')
  if (error.status === 422 || error.status === 400) return msg('Check the form fields.')
  if (error.status === 429) return msg('Too many attempts. Try again later.')
  return msg('The request failed. Please try again.')
}

export function getApiErrorMessage(error: unknown): string {
  return translate(getApiErrorKey(error))
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'),
  )
  return match ? decodeURIComponent(match[1]!) : null
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()

  if (MUTATING_METHODS.has(method)) {
    const csrf = getCookie('glosano_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' })

  if (!response.ok) {
    const text = await response.text()
    let detail = response.statusText
    let structuredDetail: unknown
    try {
      const body = JSON.parse(text) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
      else {
        structuredDetail = body.detail
        if (
          body.detail &&
          typeof body.detail === 'object' &&
          'code' in body.detail &&
          typeof body.detail.code === 'string'
        )
          detail = body.detail.code
      }
    } catch {
      // body wasn't JSON; keep statusText
    }
    throw new ApiError(response.status, detail, structuredDetail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function fetchHealth(): Promise<HealthResponse> {
  return api<HealthResponse>('/health')
}
