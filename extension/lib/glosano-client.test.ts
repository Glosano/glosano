import { createGlosanoClient } from './glosano-client'
import { GlosanoError } from './errors'

const ORIGIN = 'https://g.example.com'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(response: Response | Error, csrf: string | null = 'tok') {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  const client = createGlosanoClient({ origin: ORIGIN, fetch: fetch as unknown as typeof globalThis.fetch, getCsrfToken: async () => csrf })
  return { client, fetch }
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; detail?: string }> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(GlosanoError)
    return (e as GlosanoError).toJSON()
  }
  throw new Error('expected rejection')
}

const LESSON = { title: 'T', language_code: 'pt', raw_text: 'Olá.', source: { url: 'https://a.b/c', author: null, site_name: null } }

describe('glosano client', () => {
  it('GET /me sends cookies and no CSRF header', async () => {
    const { client, fetch } = setup(json(200, { display_name: 'Ana', learning_languages: ['pt'], last_learning_language_code: 'pt', needs_onboarding: false }))
    const me = await client.getMe()
    expect(me.display_name).toBe('Ana')
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/me`)
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).has('X-CSRF-Token')).toBe(false)
  })

  it('POST /api/lessons sends CSRF header, JSON body and private visibility', async () => {
    const { client, fetch } = setup(json(202, { id: 'L1', status: 'processing' }))
    expect(await client.createLesson(LESSON)).toEqual({ id: 'L1' })
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/lessons`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok')
    expect(JSON.parse(init.body as string)).toEqual({ ...LESSON, visibility: 'private' })
  })

  it('POST /api/lessons/import-youtube', async () => {
    const { client, fetch } = setup(json(202, { id: 'V1', status: 'processing' }))
    await client.importYoutube({ url: 'https://www.youtube.com/watch?v=abcdefghijk', language_code: 'en', request_id: 'r1' })
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/api/lessons/import-youtube`)
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://www.youtube.com/watch?v=abcdefghijk', language_code: 'en', request_id: 'r1' })
  })

  it('missing CSRF cookie -> signed_out without a request', async () => {
    const { client, fetch } = setup(json(202, {}), null)
    expect(await codeOf(client.createLesson(LESSON))).toEqual({ code: 'signed_out' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    [json(401, { detail: 'not authenticated' }), { code: 'signed_out' }],
    [json(403, { detail: 'CSRF token mismatch' }), { code: 'signed_out' }],
    [json(409, { detail: 'busy' }), { code: 'conflict' }],
    [json(422, { detail: 'unsupported_video_url' }), { code: 'validation', detail: 'unsupported_video_url' }],
    [json(422, { detail: [{ msg: 'Value error, url must be an absolute http(s) URL' }] }), { code: 'validation', detail: 'Value error, url must be an absolute http(s) URL' }],
    [json(503, { detail: 'could not queue lesson import' }), { code: 'queue_unavailable' }],
    [new Response('<html>413 Request Entity Too Large</html>', { status: 413 }), { code: 'too_large' }],
    [json(500, { detail: 'boom' }), { code: 'unknown', detail: '500' }],
    [new TypeError('Failed to fetch'), { code: 'unreachable', detail: ORIGIN }],
    [new Response('<html>proxy</html>', { status: 200 }), { code: 'unreachable', detail: ORIGIN }],
  ])('maps failures (%#)', async (response, expected) => {
    const { client } = setup(response)
    expect(await codeOf(client.createLesson(LESSON))).toEqual(expected)
  })
})
