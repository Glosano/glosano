import { getSettings, normalizeOrigin, saveInstanceOrigin, setOpenAfterImport } from './settings'

describe('normalizeOrigin', () => {
  it.each([
    ['https://glosano.example.com', 'https://glosano.example.com'],
    ['  https://glosano.example.com/learn/pt/library?x=1 ', 'https://glosano.example.com'],
    ['http://localhost:8001/', 'http://localhost:8001'],
    ['HTTPS://Glosano.Example.com', 'https://glosano.example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected)
  })

  it.each(['', 'glosano.example.com', 'ftp://example.com', 'javascript:alert(1)', 'not a url'])(
    'rejects %s',
    (input) => {
      expect(normalizeOrigin(input)).toBeNull()
    },
  )
})

describe('settings storage', () => {
  it('defaults to no instance and open-after-import on', async () => {
    expect(await getSettings()).toEqual({ instanceOrigin: null, openAfterImport: true })
  })

  it('persists values', async () => {
    await saveInstanceOrigin('https://g.example.com')
    await setOpenAfterImport(false)
    expect(await getSettings()).toEqual({ instanceOrigin: 'https://g.example.com', openAfterImport: false })
  })
})
