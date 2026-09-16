import { api } from './client'
import type { ReaderPosition } from './reader'

export type LessonVisibility = 'private' | 'shared'
export type LessonStatus = 'draft' | 'processing' | 'ready' | 'failed' | 'archived'

export interface LessonSummary {
  completed_at?: string | null
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

export interface LessonListResponse {
  items: LessonSummary[]
  total: number
  page: number
  page_size: number
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
  segment_count: number
  reader_position: ReaderPosition | null
}

export interface LessonEditData {
  id: string
  title: string
  raw_text: string
  language_code: string
  status: LessonStatus
}

interface ListParams {
  tab?: 'continue' | 'lessons'
  q?: string
  visibility?: 'mine' | 'shared' | 'all'
  page?: number
  page_size?: number
}

export const lessonsApi = {
  list: (lang: string, params: ListParams = {}) => {
    const search = new URLSearchParams({
      lang,
      ...Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    })
    return api<LessonListResponse>(`/api/lessons?${search.toString()}`)
  },
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
  get: (id: string) => api<LessonDetail>(`/api/lessons/${id}`),
  getForEdit: (id: string) => api<LessonEditData>(`/api/lessons/${id}/edit`),
  update: (id: string, data: Pick<LessonEditData, 'title' | 'raw_text'>) =>
    api<LessonEditData>(`/api/lessons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => api<void>(`/api/lessons/${id}`, { method: 'DELETE' }),
}
