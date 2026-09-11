/**
 * API client with cookie-based session + CSRF (ADR-0008).
 *
 * The backend issues `flinq_session` (HttpOnly) and `flinq_csrf` (readable JS)
 * cookies. For mutating requests we read the CSRF cookie and echo it in the
 * `X-CSRF-Token` header (double-submit pattern).
 */

import { translate } from '@/lib/i18n'

export interface HealthResponse {
  status: string
  version: string
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

export function getApiErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
  const known: Record<string, string> = {
    'Invalid password': 'Неверный пароль.',
    'Invalid current password': 'Неверный пароль.',
    'Invalid email or password': 'Неверный email или пароль.',
    'Email already in use': 'Этот email уже используется.',
    'Registration is disabled': 'Регистрация закрыта администратором.',
  }
  const key = known[error.detail]
  if (key) return key
  if (error.status === 401) return 'Сессия истекла. Войдите снова.'
  if (error.status === 403) return 'Недостаточно прав для этого действия.'
  if (error.status === 422 || error.status === 400) return 'Проверьте заполненные поля.'
  if (error.status === 429) return 'Слишком много попыток. Попробуйте позже.'
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
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
    const csrf = getCookie('flinq_csrf')
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' })

  if (!response.ok) {
    const text = await response.text()
    let detail = response.statusText
    try {
      const body = JSON.parse(text) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // body wasn't JSON; keep statusText
    }
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function fetchHealth(): Promise<HealthResponse> {
  return api<HealthResponse>('/health')
}
