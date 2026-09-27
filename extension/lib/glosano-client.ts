import { GlosanoError } from './errors'

export interface Me {
  display_name: string
  learning_languages: string[]
  last_learning_language_code: string | null
  needs_onboarding: boolean
}

export interface LessonSourceInput {
  url: string
  author: string | null
  site_name: string | null
}

export interface ClientDeps {
  origin: string
  fetch: typeof fetch
  getCsrfToken: () => Promise<string | null>
}

export interface CreateLessonInput {
  title: string
  language_code: string
  raw_text: string
  /** Omitted when the page has no provenance the API accepts. */
  source?: LessonSourceInput
  /** Omitted when empty, so imports keep working against servers without tag support. */
  tags?: string[]
}

export interface ImportYoutubeInput {
  url: string
  language_code: string
  request_id: string
  /** Omitted when empty, so imports keep working against servers without tag support. */
  tags?: string[]
}

function validationDetail(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (typeof item === 'object' && item && 'msg' in item ? String(item.msg) : String(item)))
      .join('; ')
  }
  return ''
}

export function createGlosanoClient({ origin, fetch, getCsrfToken }: ClientDeps) {
  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' })
    if (method !== 'GET') {
      const csrf = await getCsrfToken()
      if (!csrf) throw new GlosanoError('signed_out')
      headers.set('X-CSRF-Token', csrf)
      headers.set('Content-Type', 'application/json')
    }
    let response: Response
    try {
      response = await fetch(`${origin}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new GlosanoError('unreachable', origin)
    }
    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      parsed = undefined
    }
    if (response.status === 401 || response.status === 403) throw new GlosanoError('signed_out')
    if (response.status === 409) throw new GlosanoError('conflict')
    // 413 usually comes from a reverse proxy body limit in front of Glosano.
    if (response.status === 413) throw new GlosanoError('too_large')
    if (response.status === 422) throw new GlosanoError('validation', validationDetail(parsed))
    if (response.status === 503) throw new GlosanoError('queue_unavailable')
    if (!response.ok) throw new GlosanoError('unknown', String(response.status))
    // A 200 that is not JSON means a proxy or a different app answered at this address.
    if (parsed === undefined) throw new GlosanoError('unreachable', origin)
    return parsed as T
  }

  return {
    getMe: () => request<Me>('GET', '/me'),
    createLesson: async (input: CreateLessonInput) => {
      const { id } = await request<{ id: string }>('POST', '/api/lessons', { ...input, visibility: 'private' })
      return { id }
    },
    importYoutube: async (input: ImportYoutubeInput) => {
      const { id } = await request<{ id: string }>('POST', '/api/lessons/import-youtube', input)
      return { id }
    },
  }
}

export type GlosanoClient = ReturnType<typeof createGlosanoClient>
