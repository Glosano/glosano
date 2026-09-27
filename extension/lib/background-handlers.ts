import { GlosanoError } from './errors'
import type { CreateLessonInput, GlosanoClient, LessonSourceInput } from './glosano-client'
import type { BackgroundRequest, ImportResult, ImportTextRequest, ImportYoutubeRequest, Status } from './messages'
import { normalizeOrigin, type Settings } from './settings'
import { truncateCodePoints } from './text'

export const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_TITLE = 200
const FALLBACK_TITLE = 80
// Backend limits for LessonSourceIn; anything longer is a 422 that would block the import.
const MAX_SOURCE_TEXT = 200
const MAX_SOURCE_URL = 2048

export interface HandlerDeps {
  loadSettings: () => Promise<Settings>
  hasPermission: (origin: string) => Promise<boolean>
  makeClient: (origin: string) => GlosanoClient
  openTab: (url: string) => Promise<void>
  newRequestId: () => string
}

export function lessonTitle(title: string, text: string): string {
  const trimmed = title.trim()
  if (trimmed) return truncateCodePoints(trimmed, MAX_TITLE)
  const firstLine = text.trim().split('\n')[0] ?? ''
  return truncateCodePoints(firstLine.trim(), FALLBACK_TITLE)
}

function sourceText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? truncateCodePoints(trimmed, MAX_SOURCE_TEXT) : null
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol, host } = new URL(value)
    return (protocol === 'http:' || protocol === 'https:') && host !== ''
  } catch {
    return false
  }
}

/**
 * Provenance is optional metadata: when the page URL is not something the API
 * accepts (file://, overlong), drop it rather than refuse to import the text.
 */
function lessonSource(source: LessonSourceInput): LessonSourceInput | undefined {
  const url = source.url.trim()
  if (url.length > MAX_SOURCE_URL || !isHttpUrl(url)) return undefined
  return { url, author: sourceText(source.author), site_name: sourceText(source.site_name) }
}

function failure(error: unknown): ImportResult {
  if (error instanceof GlosanoError) return { ok: false, error: error.toJSON() }
  return { ok: false, error: { code: 'unknown', detail: String(error) } }
}

export function createHandlers(deps: HandlerDeps) {
  async function connection(): Promise<{ origin: string; client: GlosanoClient; openAfterImport: boolean }> {
    const { instanceOrigin, openAfterImport } = await deps.loadSettings()
    if (!instanceOrigin) throw new GlosanoError('unconfigured')
    if (!(await deps.hasPermission(instanceOrigin))) throw new GlosanoError('no_permission')
    return { origin: instanceOrigin, client: deps.makeClient(instanceOrigin), openAfterImport }
  }

  async function finish(origin: string, language: string, id: string, open: boolean): Promise<ImportResult> {
    const lessonUrl = `${origin}/learn/${language}/lessons/${id}`
    if (open) {
      try {
        await deps.openTab(lessonUrl)
      } catch (error) {
        // Opening the tab is a convenience. The lesson already exists on the server,
        // so a failure here must not look like the import itself failed — that would
        // invite a retry that creates a duplicate lesson.
        console.warn('Failed to open the imported lesson tab', error)
      }
    }
    return { ok: true, lessonId: id, lessonUrl }
  }

  return {
    async getStatus(): Promise<Status> {
      const { instanceOrigin } = await deps.loadSettings()
      if (!instanceOrigin) return { status: 'unconfigured' }
      if (!(await deps.hasPermission(instanceOrigin))) return { status: 'no_permission', origin: instanceOrigin }
      try {
        const me = await deps.makeClient(instanceOrigin).getMe()
        if (me.needs_onboarding) return { status: 'needs_onboarding', origin: instanceOrigin }
        return { status: 'ready', origin: instanceOrigin, me }
      } catch (error) {
        const signedOut = error instanceof GlosanoError && error.code === 'signed_out'
        return { status: signedOut ? 'signed_out' : 'unreachable', origin: instanceOrigin }
      }
    },

    async importText(request: ImportTextRequest): Promise<ImportResult> {
      if (!request.text.trim()) return { ok: false, error: { code: 'empty_text' } }
      if (new TextEncoder().encode(request.text).length > MAX_TEXT_BYTES) return { ok: false, error: { code: 'too_large' } }
      try {
        const { origin, client, openAfterImport } = await connection()
        const input: CreateLessonInput = {
          title: lessonTitle(request.title, request.text),
          language_code: request.language_code,
          raw_text: request.text,
        }
        const source = lessonSource(request.source)
        if (source) input.source = source
        const { id } = await client.createLesson(input)
        return await finish(origin, request.language_code, id, openAfterImport)
      } catch (error) {
        return failure(error)
      }
    },

    async importYoutube(request: ImportYoutubeRequest): Promise<ImportResult> {
      try {
        const { origin, client, openAfterImport } = await connection()
        const { id } = await client.importYoutube({
          url: request.url,
          language_code: request.language_code,
          request_id: deps.newRequestId(),
        })
        return await finish(origin, request.language_code, id, openAfterImport)
      } catch (error) {
        return failure(error)
      }
    },

    // Any extension context (or a compromised content script) can send this
    // message, so only pages of the configured Glosano instance are opened.
    async openUrl(url: string): Promise<void> {
      const { instanceOrigin } = await deps.loadSettings()
      if (!instanceOrigin || normalizeOrigin(url) !== instanceOrigin) return
      await deps.openTab(url)
    },
  }
}

export type Handlers = ReturnType<typeof createHandlers>

export function handleMessage(handlers: Handlers, message: BackgroundRequest): Promise<unknown> {
  switch (message.type) {
    case 'getStatus':
      return handlers.getStatus()
    case 'importText':
      return handlers.importText(message)
    case 'importYoutube':
      return handlers.importYoutube(message)
    case 'openUrl':
      return handlers.openUrl(message.url)
  }
}
