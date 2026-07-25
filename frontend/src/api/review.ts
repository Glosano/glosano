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

export type ReviewMode = 'cards' | 'new' | 'cloze' | 'reverse' | 'translation'

export interface ReviewCounts {
  due: number
  new: number
  practice: number
  ai_enabled: boolean
}

export interface ExerciseOption {
  text: string
  is_correct: boolean
}

export interface ExampleExercise {
  sentence: string
  sentence_translation: string
  base_form: string
  base_form_translation: string
}

export interface ClozeExercise {
  sentence_with_gap: string
  sentence_translation: string
  options: ExerciseOption[]
}

export interface ReverseExercise {
  sentence: string
  options: ExerciseOption[]
}

export interface ExerciseResponse<P> {
  payload: P
  model: string
  latency_ms: number
}

export const reviewApi = {
  queue: (lang: string, lessonId?: string, mode?: string) => {
    const q = new URLSearchParams({ lang })
    if (lessonId) q.set('lesson_id', lessonId)
    if (mode) q.set('mode', mode)
    return api<ReviewQueueResponse>(`/api/review/queue?${q.toString()}`)
  },
  answer: (reviewItemId: string, quality: number) =>
    api<ReviewAnswerResponse>('/api/review/answer', {
      method: 'POST',
      body: JSON.stringify({ review_item_id: reviewItemId, quality }),
    }),
  counts: (lang: string, lessonId?: string) => {
    const q = new URLSearchParams({ lang })
    if (lessonId) q.set('lesson_id', lessonId)
    return api<ReviewCounts>(`/api/review/counts?${q.toString()}`)
  },
  exercise: <P,>(body: {
    kind: 'example' | 'cloze' | 'reverse' | 'translation_task' | 'writing'
    review_item_id?: string
    review_item_ids?: string[]
  }) =>
    api<ExerciseResponse<P>>('/api/review/exercise', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  exerciseFeedback: (body: {
    review_item_id: string
    sentence_translation: string
    user_text: string
  }) =>
    api<{ feedback: string }>('/api/review/exercise/feedback', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
