import { afterEach, expect, it, vi } from 'vitest'
import { api } from './client'
afterEach(() => vi.unstubAllGlobals())
it('retains structured conflict recovery while sending session cookies and CSRF', async () => {
  document.cookie = 'glosano_csrf=csrf-test'
  const detail = { code: 'draft_conflict', draft: { revision: 2, text: 'Remote' } }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(api('/api/chats/drafts/new', { method: 'PUT', body: '{}' })).rejects.toMatchObject({
    status: 409,
    detail: 'draft_conflict',
    structuredDetail: detail,
  })
  expect(fetch.mock.calls[0]![1].credentials).toBe('include')
  expect(fetch.mock.calls[0]![1].headers.get('X-CSRF-Token')).toBe('csrf-test')
})
