import { api } from './client'
import type { CardStatus, ItemKind } from './vocabulary'

export interface WordToken {
  t: string
  n: string
  i: number
}
export interface WhitespaceToken {
  ws: string
}
export interface PunctToken {
  p: string
}
export type Token = WordToken | WhitespaceToken | PunctToken
export const isWord = (tok: Token): tok is WordToken => 't' in tok

export interface Sentence {
  seg_id: string
  index: number
  text: string
  normalized_text: string
  tokens: Token[]
}
export interface Paragraph {
  sentences: Sentence[]
}
export interface LessonContent {
  lesson_id: string
  source_version: number
  language_code: string
  word_count: number
  paragraphs: Paragraph[]
}

export type TokenStatus = 'tracked' | 'known' | 'ignored'
export interface TokenStatusEntry {
  s: TokenStatus
  c?: number | null
}
export type StatusMap = Record<string, TokenStatusEntry>

export interface ReaderPosition {
  completed_at?: string | null
  completion_action_id?: string | null
  view_mode: 'page' | 'sentence'
  current_segment_id: string | null
  current_token_ordinal: number | null
}
export interface BulkKnownResult {
  action_id: string
  created_count: number
}
export interface CompleteLessonRequest {
  lesson_id: string
  source_version: number
  view_mode: 'page' | 'sentence'
  last_segment_id: string | null
  from_ordinal: number | null
  to_ordinal: number | null
}
export interface CompletionSummary {
  total_words: number
  unique_words: number
  known_words: number
  new_words: number
  tracked_words: number
  ignored_words: number
  added_words: number
  added_phrases: number
  reading_days: number
  marked_known_words: number
}
export interface CompleteLessonResult extends BulkKnownResult {
  completed_at: string
  summary?: CompletionSummary | null
}
export interface SegmentTranslation {
  text: string
  source: string
  model: string
  stored: boolean
}

export interface LessonVocabularyItem {
  kind: ItemKind
  item_id: string | null
  text: string
  display_text: string
  status: CardStatus
  confidence: number | null
  primary_translation: { text: string; target_language_code: string } | null
  added_here: boolean
  context: {
    segment_id: string
    token_ordinal: number
    sentence_text: string
  } | null
}

export interface LessonVocabularyResponse {
  lesson_id: string
  language_code: string
  items: LessonVocabularyItem[]
}

export const readerApi = {
  content: (lessonId: string) => api<LessonContent>(`/api/lessons/${lessonId}/content`),
  statuses: (lessonId: string) =>
    api<{ statuses: StatusMap }>(`/api/lessons/${lessonId}/token-statuses`).then((r) => r.statuses),
  vocabulary: (lessonId: string, target: string) => {
    const params = new URLSearchParams({ target })
    return api<LessonVocabularyResponse>(`/api/lessons/${lessonId}/vocabulary?${params}`)
  },
  putPosition: (body: { lesson_id: string; source_version?: number } & ReaderPosition) =>
    api<void>('/api/reader/positions', { method: 'PUT', body: JSON.stringify(body) }),
  bulkKnown: (body: {
    lesson_id: string
    source_version?: number
    from_ordinal: number
    to_ordinal: number
  }) =>
    api<BulkKnownResult>('/api/reader/bulk-known', { method: 'POST', body: JSON.stringify(body) }),
  completionSummary: (lessonId: string, actionId: string) =>
    api<CompleteLessonResult>(
      `/api/lessons/${lessonId}/completion-summary?action_id=${encodeURIComponent(actionId)}`,
    ),
  complete: (body: CompleteLessonRequest) =>
    api<CompleteLessonResult>('/api/reader/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  undoBulk: (actionId: string) =>
    api<{ undone_count: number }>(`/api/reader/bulk-actions/${actionId}/undo`, { method: 'POST' }),
  segmentTranslation: (lessonId: string, segId: string, target: string) =>
    api<SegmentTranslation>(`/api/lessons/${lessonId}/segments/${segId}/translation`, {
      method: 'POST',
      body: JSON.stringify({ target_language_code: target }),
    }),
}
