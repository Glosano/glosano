import { afterEach, expect, it, vi } from 'vitest'

import { lessonsApi } from './lessons'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body))
    }),
  )
  return calls
}

it('repeats the tag parameter for every selected tag', async () => {
  const calls = stubFetch({ items: [] })
  await lessonsApi.continue('pt', { tag: ['news', 'b2'] })
  expect(calls[0]?.url).toBe('/api/lessons/continue?lang=pt&tag=news&tag=b2')
})

it('sends file tags as one comma-separated field and omits empty tags', async () => {
  const calls = stubFetch({ id: 'L1', status: 'processing' })
  const file = new File(['Olá'], 'a.txt', { type: 'text/plain' })
  await lessonsApi.importFile(file, 'A', 'pt', ['news', 'b2'])
  await lessonsApi.importFile(file, 'A', 'pt')
  expect((calls[0]?.init.body as FormData).get('tags')).toBe('news, b2')
  expect((calls[1]?.init.body as FormData).has('tags')).toBe(false)
})

it('replaces lesson tags with PUT and reads the tag list', async () => {
  const calls = stubFetch({ tags: ['news'] })
  await expect(lessonsApi.setTags('L1', ['news'])).resolves.toEqual({ tags: ['news'] })
  expect(calls[0]?.url).toBe('/api/lessons/L1/tags')
  expect(calls[0]?.init.method).toBe('PUT')
  expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ tags: ['news'] })
  await lessonsApi.tags('pt')
  expect(calls[1]?.url).toBe('/api/lessons/tags?lang=pt')
})
