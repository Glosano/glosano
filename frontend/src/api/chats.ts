import { api } from './client'
export type ExerciseKind = 'single_choice' | 'gap' | 'free_response'
export interface ChatDraft {
  revision: number
  text: string
  citation_ids: string[]
  exercise_id: string | null
  attempt_id: string | null
  answers: Record<string, string>
}
export interface Citation {
  id: string
  lesson_id: string | null
  source_version: number
  title: string
  language_code: string
  selected_text: string
  context_text: string
  from_ordinal: number
  to_ordinal: number
  paragraph_index?: number | null
  context_start_offset?: number | null
  context_end_offset?: number | null
  start_offset: number
  end_offset: number
  media_start_ms: number | null
  media_end_ms: number | null
  source_available: boolean
  current_source_version: number | null
  source_current: boolean
}
export interface Exercise {
  id: string
  conversation_id: string
  message_id: string
  kind: ExerciseKind
  prompt: string
  options?: { id: string; text: string }[]
  goal?: string
}
export interface Attempt {
  id: string
  exercise_id: string
  conversation_id: string
  operation_id: string
  answer: string
  status: 'pending' | 'complete' | 'failed'
  correct: boolean | null
  feedback: string | null
  created_at: string
}
export interface Generation {
  id: string
  conversation_id: string
  operation_id: string
  kind: 'reply' | 'exercise' | 'evaluation'
  message_id: string | null
  attempt_id: string | null
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted'
  partial_text: string
  heartbeat_at: string | null
  error_code: string | null
  context_truncated: boolean
  exercise_kind: ExerciseKind | null
  ui_language: string
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  state: 'complete' | 'pending' | 'error' | 'cancelled'
  ui_language: string
  created_at: string
  exercise_id: string | null
  attempt_id: string | null
  citations: Citation[]
  exercises: Exercise[]
}
export interface Conversation {
  id: string
  title: string
  learning_language_code: string
  created_at: string
  updated_at: string
}
export interface ChatDetail extends Conversation {
  messages: ChatMessage[]
  attempts: Attempt[]
  generations: Generation[]
  ai_enabled: boolean
}
export interface Capabilities {
  ai_enabled: boolean
  context_char_budget: number
  answer_max_tokens: number
  max_attachments: number
  attachment_char_limit: number
  draft_text_char_limit: number
}
export interface SendCommand {
  operation_id: string
  conversation_id: string | null
  draft_revision: number
  learning_language_code?: string
  kind: 'reply' | 'exercise'
  exercise_kind: ExerciseKind | null
}
const root = '/api/chats'
const draftPath = (id: string | null) => (id ? `${root}/${id}/draft` : `${root}/drafts/new`)
const json = (method: string, value: unknown) => ({ method, body: JSON.stringify(value) })
export const chatsApi = {
  list: (offset = 0) => api<{ items: Conversation[] }>(`${root}?limit=50&offset=${offset}`),
  capabilities: () => api<Capabilities>(`${root}/capabilities`),
  detail: (id: string, before?: string) =>
    api<ChatDetail>(
      `${root}/${id}?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    ),
  rename: (id: string, title: string) =>
    api<Conversation>(`${root}/${id}`, json('PATCH', { title })),
  delete: (id: string) => api<void>(`${root}/${id}`, { method: 'DELETE' }),
  draft: (id: string | null) => api<ChatDraft>(draftPath(id)),
  saveDraft: (id: string | null, draft: ChatDraft) =>
    api<ChatDraft>(draftPath(id), json('PUT', draft)),
  citation: (id: string) => api<Citation>(`${root}/citations/${id}`),
  prepareCitation: (body: {
    lesson_id: string
    source_version: number
    from_ordinal: number
    to_ordinal: number
    context: 'sentence' | 'paragraph'
  }) => api<Citation>(`${root}/citations`, json('POST', body)),
  prepareParagraphCitation: (body: {
    lesson_id: string
    source_version: number
    segment_id: string
  }) => api<Citation>(`${root}/citations/paragraph`, json('POST', body)),
  send: (body: SendCommand) =>
    api<{ conversation_id: string; generation: Generation }>(`${root}/send`, json('POST', body)),
  cancel: (cid: string, gid: string) =>
    api<Generation>(`${root}/${cid}/generations/${gid}/cancel`, { method: 'POST' }),
  retry: (cid: string, gid: string, operation_id: string) =>
    api<Generation>(`${root}/${cid}/generations/${gid}/retry`, json('POST', { operation_id })),
  exercise: (cid: string, eid: string) => api<Exercise>(`${root}/${cid}/exercises/${eid}`),
  attempts: (cid: string, eid: string, offset = 0) =>
    api<{ items: Attempt[] }>(`${root}/${cid}/exercises/${eid}/attempts?limit=50&offset=${offset}`),
  attempt: (cid: string, eid: string, answer: string, operation_id: string) =>
    api<Attempt>(
      `${root}/${cid}/exercises/${eid}/attempts`,
      json('POST', { answer, operation_id }),
    ),
  evaluate: (cid: string, aid: string, operation_id: string) =>
    api<Generation>(`${root}/${cid}/attempts/${aid}/evaluate`, json('POST', { operation_id })),
}
