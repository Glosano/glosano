import { api } from './client'

export interface ReviewQueueItem {
  review_item_id: string
  item_kind: 'token' | 'phrase'
  item_id: string
  text: string
  confidence: number
  translation: string | null
  notes: string | null
  context_sentence: string | null
}

export interface ReviewDaily {
  limit: number
  done_today: number
  limit_reached: boolean
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[]
  daily: ReviewDaily
}

export interface ReviewAnswerResponse {
  new_confidence: number | null
  new_status: 'tracked' | 'known'
  due_at: string
  done_today: number
}

export const reviewApi = {
  queue: (lang: string, lessonId?: string) => {
    const q = new URLSearchParams({ lang })
    if (lessonId) q.set('lesson_id', lessonId)
    return api<ReviewQueueResponse>(`/api/review/queue?${q.toString()}`)
  },
  answer: (reviewItemId: string, answer: 'correct' | 'wrong') =>
    api<ReviewAnswerResponse>('/api/review/answer', {
      method: 'POST',
      body: JSON.stringify({ review_item_id: reviewItemId, answer }),
    }),
}
