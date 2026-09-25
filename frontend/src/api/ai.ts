import { api } from './client'

export interface TranslateResponse {
  hints: { text: string }[]
  model: string
  latency_ms: number
}

export const aiApi = {
  wordTags: (body: {
    surface_text: string; context_text: string; language_code: string; lesson_id?: string
  }) => api<{ tags: string[]; model: string; latency_ms: number }>(
    '/api/ai/word-tags', { method: 'POST', body: JSON.stringify(body) },
  ),
  translate: (body: {
    surface_text: string; context_text: string
    target_language_code: string; lesson_id?: string
  }) => api<TranslateResponse>('/api/ai/translate', { method: 'POST', body: JSON.stringify(body) }),
}
