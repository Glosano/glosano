import { readCsrfToken } from './csrf'

const ORIGIN = 'https://g.example.com'

describe('readCsrfToken', () => {
  it('returns the glosano_csrf cookie value for the instance', async () => {
    const get = vi.fn(async () => ({ value: 'tok' }))
    expect(await readCsrfToken({ get }, ORIGIN)).toBe('tok')
    expect(get).toHaveBeenCalledWith({ url: ORIGIN, name: 'glosano_csrf' })
  })

  it('returns null without the cookie', async () => {
    expect(await readCsrfToken({ get: vi.fn(async () => null) }, ORIGIN)).toBeNull()
  })

  it('returns null when the cookie lookup throws (Firefox first-party isolation)', async () => {
    const get = vi.fn(async () => {
      throw new Error('First-Party Isolation is enabled, but the required \'firstPartyDomain\' attribute was not set.')
    })
    expect(await readCsrfToken({ get }, ORIGIN)).toBeNull()
  })
})
