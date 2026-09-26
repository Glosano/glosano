import { api } from './client'
import type { ReaderPosition } from './reader'

export type LessonVisibility = 'private' | 'shared'
export type LessonStatus = 'draft' | 'processing' | 'ready' | 'failed' | 'archived'

export interface LessonMedia {
  provider: 'youtube'
  video_id: string
  canonical_url: string
  title: string
  author: string | null
  language_code: string
  is_generated: boolean
}
export interface ImportError {
  code: string
  retryable: boolean
}
export interface VideoFragment {
  seg_id: string
  text: string
  media_start_ms: number
  media_end_ms: number
}

export interface LessonSummary {
  source_type?: string | null
  completed_at?: string | null
  last_activity_at?: string | null
  id: string
  title: string
  language_code: string
  word_count: number
  visibility: LessonVisibility
  status: LessonStatus
  created_at: string
  read_percent: number
  new_words_remaining: number
  can_manage: boolean
}

export interface LessonHistoryDay {
  date: string
  total: number
  items: LessonSummary[]
}

export interface LessonHistoryResponse {
  days: LessonHistoryDay[]
  next_before: string | null
}

export interface LessonCreated {
  id: string
  status: LessonStatus
}

export interface CreateLessonPayload {
  title: string
  language_code: string
  raw_text: string
  visibility?: LessonVisibility
}

export type LessonDetail = Omit<LessonSummary, 'can_manage'> & {
  media?: LessonMedia | null
  import_error?: ImportError | null
  segment_count: number
  reader_position: ReaderPosition | null
}

export interface LessonEditData {
  source_version?: number
  media?: LessonMedia | null
  fragments?: VideoFragment[] | null
  id: string
  title: string
  raw_text: string
  language_code: string
  status: LessonStatus
}

function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  return search.toString()
}

export const lessonsApi = {
  continue: (lang: string, params: { q?: string } = {}) =>
    api<{ items: LessonSummary[] }>(`/api/lessons/continue?${queryString({ lang, ...params })}`),
  history: (lang: string, params: { q?: string; tz: string; before?: string }) =>
    api<LessonHistoryResponse>(`/api/lessons/history?${queryString({ lang, ...params })}`),
  create: (data: CreateLessonPayload) =>
    api<LessonCreated>('/api/lessons', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importFile: (file: File, title: string, languageCode: string) => {
    const body = new FormData()
    body.set('file', file)
    body.set('title', title)
    body.set('language_code', languageCode)
    return api<LessonCreated>('/api/lessons/import-file', { method: 'POST', body })
  },
  importYouTube: (data: { url: string; language_code: string; request_id: string }) =>
    api<LessonCreated>('/api/lessons/import-youtube', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  retryImport: (id: string) =>
    api<LessonCreated>(`/api/lessons/${id}/retry-import`, { method: 'POST' }),
  get: (id: string) => api<LessonDetail>(`/api/lessons/${id}`),
  getForEdit: (id: string) => api<LessonEditData>(`/api/lessons/${id}/edit`),
  update: (
    id: string,
    data:
      | Pick<LessonEditData, 'title' | 'raw_text'>
      | {
          title: string
          source_version: number
          fragments: Pick<VideoFragment, 'seg_id' | 'text'>[]
        },
  ) => api<LessonEditData>(`/api/lessons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => api<void>(`/api/lessons/${id}`, { method: 'DELETE' }),
}
