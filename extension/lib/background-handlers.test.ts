import { GlosanoError } from './errors'
import { createHandlers, handleMessage, lessonTitle, MAX_TEXT_BYTES, type HandlerDeps } from './background-handlers'
import type { GlosanoClient, Me } from './glosano-client'

const ORIGIN = 'https://g.example.com'
const ME: Me = { display_name: 'Ana', learning_languages: ['pt'], last_learning_language_code: 'pt', needs_onboarding: false }
const SOURCE = { url: 'https://a.b/c', author: null, site_name: null }

function client(overrides: Partial<GlosanoClient> = {}): GlosanoClient {
  return {
    getMe: vi.fn(async () => ME),
    createLesson: vi.fn(async () => ({ id: 'L1' })),
    importYoutube: vi.fn(async () => ({ id: 'V1' })),
    ...overrides,
  }
}

function deps(overrides: Partial<HandlerDeps> = {}, c: GlosanoClient = client()): HandlerDeps {
  return {
    loadSettings: async () => ({ instanceOrigin: ORIGIN, openAfterImport: true }),
    hasPermission: async () => true,
    makeClient: () => c,
    openTab: vi.fn(async () => {}),
    newRequestId: () => 'req-1',
    ...overrides,
  }
}

describe('getStatus', () => {
  it('unconfigured without an origin', async () => {
    const h = createHandlers(deps({ loadSettings: async () => ({ instanceOrigin: null, openAfterImport: true }) }))
    expect(await h.getStatus()).toEqual({ status: 'unconfigured' })
  })

  it('no_permission when host access is missing', async () => {
    const h = createHandlers(deps({ hasPermission: async () => false }))
    expect(await h.getStatus()).toEqual({ status: 'no_permission', origin: ORIGIN })
  })

  it.each([
    ['signed_out', 'signed_out'],
    ['unreachable', 'unreachable'],
    ['unknown', 'unreachable'],
  ] as const)('%s from /me -> %s', async (code, status) => {
    const c = client({ getMe: vi.fn(async () => { throw new GlosanoError(code) }) })
    expect(await createHandlers(deps({}, c)).getStatus()).toEqual({ status, origin: ORIGIN })
  })

  it('needs_onboarding and ready', async () => {
    const onboarding = client({ getMe: vi.fn(async () => ({ ...ME, needs_onboarding: true })) })
    expect(await createHandlers(deps({}, onboarding)).getStatus()).toEqual({ status: 'needs_onboarding', origin: ORIGIN })
    expect(await createHandlers(deps()).getStatus()).toEqual({ status: 'ready', origin: ORIGIN, me: ME })
  })
})

describe('importText', () => {
  it('creates a lesson, opens it and returns its URL', async () => {
    const c = client()
    const d = deps({}, c)
    const result = await createHandlers(d).importText({ title: ' Artigo ', language_code: 'pt', text: 'Olá.', source: SOURCE })
    expect(result).toEqual({ ok: true, lessonId: 'L1', lessonUrl: `${ORIGIN}/learn/pt/lessons/L1` })
    expect(c.createLesson).toHaveBeenCalledWith({ title: 'Artigo', language_code: 'pt', raw_text: 'Olá.', source: SOURCE })
    expect(d.openTab).toHaveBeenCalledWith(`${ORIGIN}/learn/pt/lessons/L1`)
  })

  it('still succeeds when opening the tab fails, so a retry cannot create a duplicate lesson', async () => {
    const c = client()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({ openTab: vi.fn(async () => { throw new Error('blocked') }) }, c)
    const result = await createHandlers(d).importText({ title: 'T', language_code: 'pt', text: 'Olá.', source: SOURCE })
    expect(result).toEqual({ ok: true, lessonId: 'L1', lessonUrl: `${ORIGIN}/learn/pt/lessons/L1` })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not open a tab when the setting is off', async () => {
    const d = deps({ loadSettings: async () => ({ instanceOrigin: ORIGIN, openAfterImport: false }) })
    await createHandlers(d).importText({ title: 'T', language_code: 'pt', text: 'Olá.', source: SOURCE })
    expect(d.openTab).not.toHaveBeenCalled()
  })

  it('rejects empty and oversized text without a request', async () => {
    const c = client()
    const h = createHandlers(deps({}, c))
    expect(await h.importText({ title: 'T', language_code: 'pt', text: ' \n ', source: SOURCE })).toEqual({ ok: false, error: { code: 'empty_text' } })
    const big = 'é'.repeat(MAX_TEXT_BYTES / 2 + 1)
    expect(await h.importText({ title: 'T', language_code: 'pt', text: big, source: SOURCE })).toEqual({ ok: false, error: { code: 'too_large' } })
    expect(c.createLesson).not.toHaveBeenCalled()
  })

  it('returns client errors as results', async () => {
    const c = client({ createLesson: vi.fn(async () => { throw new GlosanoError('queue_unavailable') }) })
    expect(await createHandlers(deps({}, c)).importText({ title: 'T', language_code: 'pt', text: 'x', source: SOURCE })).toEqual({ ok: false, error: { code: 'queue_unavailable' } })
  })

  it('reports unconfigured and no_permission', async () => {
    const none = deps({ loadSettings: async () => ({ instanceOrigin: null, openAfterImport: true }) })
    expect((await createHandlers(none).importText({ title: 'T', language_code: 'pt', text: 'x', source: SOURCE })).ok).toBe(false)
    const denied = deps({ hasPermission: async () => false })
    expect(await createHandlers(denied).importText({ title: 'T', language_code: 'pt', text: 'x', source: SOURCE })).toEqual({ ok: false, error: { code: 'no_permission' } })
  })

  it('forwards non-empty tags and leaves empty ones out of the request', async () => {
    const c = client()
    const h = createHandlers(deps({}, c))
    await h.importText({ title: 'T', language_code: 'pt', text: 'Olá.', source: SOURCE, tags: ['news'] })
    await h.importText({ title: 'T', language_code: 'pt', text: 'Olá.', source: SOURCE, tags: [] })
    expect(c.createLesson).toHaveBeenNthCalledWith(1, { title: 'T', language_code: 'pt', raw_text: 'Olá.', source: SOURCE, tags: ['news'] })
    expect(c.createLesson).toHaveBeenNthCalledWith(2, { title: 'T', language_code: 'pt', raw_text: 'Olá.', source: SOURCE })
  })
})

describe('importYoutube', () => {
  it('sends a fresh request id', async () => {
    const c = client()
    const result = await createHandlers(deps({}, c)).importYoutube({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en' })
    expect(result).toEqual({ ok: true, lessonId: 'V1', lessonUrl: `${ORIGIN}/learn/en/lessons/V1` })
    expect(c.importYoutube).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en', request_id: 'req-1' })
  })

  it('forwards tags', async () => {
    const c = client()
    await createHandlers(deps({}, c)).importYoutube({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en', tags: ['music'] })
    expect(c.importYoutube).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en', request_id: 'req-1', tags: ['music'] })
  })
})

describe('handleMessage', () => {
  it('sends only the API fields for importYoutube, not the runtime message type', async () => {
    const c = client()
    const handlers = createHandlers(deps({}, c))
    await handleMessage(handlers, { type: 'importYoutube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en' })
    expect(c.importYoutube).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en', request_id: 'req-1' })
  })

  it('sends only the API fields for importText, not the runtime message type', async () => {
    const c = client()
    const handlers = createHandlers(deps({}, c))
    await handleMessage(handlers, { type: 'importText', title: 'T', language_code: 'pt', text: 'Olá.', source: SOURCE })
    expect(c.createLesson).toHaveBeenCalledWith({ title: 'T', language_code: 'pt', raw_text: 'Olá.', source: SOURCE })
  })
})

describe('handleMessage provenance', () => {
  async function sentLesson(source: { url: string; author: string | null; site_name: string | null }) {
    const c = client()
    await handleMessage(createHandlers(deps({}, c)), { type: 'importText', title: 'T', language_code: 'pt', text: 'Olá.', source })
    return vi.mocked(c.createLesson).mock.calls[0]![0]
  }

  it('trims author and site name and caps them at 200 characters', async () => {
    const payload = await sentLesson({ url: 'https://a.b/c', author: `  ${'a'.repeat(250)}  `, site_name: '   ' })
    expect(payload).toEqual({
      title: 'T',
      language_code: 'pt',
      raw_text: 'Olá.',
      source: { url: 'https://a.b/c', author: 'a'.repeat(200), site_name: null },
    })
  })

  it('omits provenance for a non-http page', async () => {
    const payload = await sentLesson({ url: 'file:///home/ana/a.html', author: 'Ana', site_name: null })
    expect(payload).toEqual({ title: 'T', language_code: 'pt', raw_text: 'Olá.' })
  })

  it('omits provenance when the URL is longer than the API accepts', async () => {
    const payload = await sentLesson({ url: `https://a.b/${'x'.repeat(3000)}`, author: null, site_name: null })
    expect(payload).toEqual({ title: 'T', language_code: 'pt', raw_text: 'Olá.' })
  })
})

describe('handleMessage openUrl', () => {
  it.each([
    'https://evil.example/x',
    'http://g.example.com/learn/pt/lessons/L1',
    'https://g.example.com.evil.example/x',
    'javascript:alert(1)',
    'not a url',
  ])('ignores %s, which is not on the configured instance', async (url) => {
    const d = deps()
    await handleMessage(createHandlers(d), { type: 'openUrl', url })
    expect(d.openTab).not.toHaveBeenCalled()
  })

  it('opens pages of the configured instance', async () => {
    const d = deps()
    await handleMessage(createHandlers(d), { type: 'openUrl', url: `${ORIGIN}/learn/pt/lessons/L1` })
    expect(d.openTab).toHaveBeenCalledWith(`${ORIGIN}/learn/pt/lessons/L1`)
  })

  it('opens nothing when no instance is configured', async () => {
    const d = deps({ loadSettings: async () => ({ instanceOrigin: null, openAfterImport: true }) })
    await handleMessage(createHandlers(d), { type: 'openUrl', url: `${ORIGIN}/login` })
    expect(d.openTab).not.toHaveBeenCalled()
  })
})

describe('lessonTitle', () => {
  it('trims and caps at 200 characters', () => {
    expect(lessonTitle('  a  ', 'x')).toBe('a')
    expect(lessonTitle('b'.repeat(250), 'x')).toHaveLength(200)
  })

  it('falls back to the first line of the text', () => {
    expect(lessonTitle('   ', '  Primeira linha do texto\n\nresto')).toBe('Primeira linha do texto')
    expect(lessonTitle('', 'c'.repeat(300))).toBe('c'.repeat(80))
  })

  it('does not split an emoji at the 200-character cap', () => {
    const title = lessonTitle(`${'a'.repeat(199)}😀tail`, 'x')
    expect(title).toBe(`${'a'.repeat(199)}😀`)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
