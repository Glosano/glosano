import { browser } from 'wxt/browser'
import type { ImportError } from './errors'
import type { LessonSourceInput, Me } from './glosano-client'

export type Status =
  | { status: 'unconfigured' }
  | { status: 'no_permission' | 'unreachable' | 'signed_out' | 'needs_onboarding'; origin: string }
  | { status: 'ready'; origin: string; me: Me }

export interface ImportTextRequest {
  title: string
  language_code: string
  text: string
  source: LessonSourceInput
  tags?: string[]
}

export interface ImportYoutubeRequest {
  url: string
  language_code: string
  tags?: string[]
}

export type ImportResult = { ok: true; lessonId: string; lessonUrl: string } | { ok: false; error: ImportError }

export type BackgroundRequest =
  | { type: 'getStatus' }
  | ({ type: 'importText' } & ImportTextRequest)
  | ({ type: 'importYoutube' } & ImportYoutubeRequest)
  | { type: 'openUrl'; url: string }

function send<T>(message: BackgroundRequest): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>
}

export const requestStatus = () => send<Status>({ type: 'getStatus' })
export const requestImportText = (p: ImportTextRequest) => send<ImportResult>({ type: 'importText', ...p })
export const requestImportYoutube = (p: ImportYoutubeRequest) => send<ImportResult>({ type: 'importYoutube', ...p })
export const requestOpenUrl = (url: string) => send<void>({ type: 'openUrl', url })
