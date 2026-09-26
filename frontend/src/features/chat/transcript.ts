import type { ReactNode } from 'react'

export type ChatTranscriptMessageState = 'complete' | 'pending' | 'error' | 'cancelled'

export type ChatTranscriptTextPart = Readonly<{
  type: 'text'
  text: string
}>

export type ChatTranscriptExercisePart = Readonly<{
  type: 'exercise'
  exerciseId: string
  exerciseType: string
  prompt: string
}>

export type ChatTranscriptPart = ChatTranscriptTextPart | ChatTranscriptExercisePart

export type ChatTranscriptMessage = Readonly<{
  id: string
  role: 'user' | 'assistant'
  parts: readonly ChatTranscriptPart[]
  state: ChatTranscriptMessageState
  createdAt?: string
  error?: string
}>

export type ExerciseRenderContext = Readonly<{
  conversationId: string
  messageId: string
  exercise: ChatTranscriptExercisePart
}>

export type ChatTranscriptProps = Readonly<{
  conversationId: string
  messages: readonly ChatTranscriptMessage[]
  showComposer?: boolean
  renderText?: (text: string) => ReactNode
  renderMessageMeta?: (messageId: string) => ReactNode
  /** Rendered below the message, outside the bubble (copy, AI label). */
  renderMessageActions?: (messageId: string) => ReactNode
  readOnly?: boolean
  onSend?: (conversationId: string, text: string) => Promise<void> | void
  onCancel?: (conversationId: string) => Promise<void> | void
  renderExercise?: (context: ExerciseRenderContext) => ReactNode
}>
