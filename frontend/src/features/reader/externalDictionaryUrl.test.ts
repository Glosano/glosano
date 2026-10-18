import { describe, expect, it } from 'vitest'
import { buildDictionaryUrl } from './externalDictionaryUrl'

const d = (url_template: string, word_encoding: 'default' | 'no_slash' = 'default') => ({
  url_template,
  word_encoding,
})

describe('buildDictionaryUrl', () => {
  it('fills a Reverso pair template', () => {
    expect(
      buildDictionaryUrl(
        d('https://context.reverso.net/translation/portuguese-russian/{word}'),
        'trem',
      ),
    ).toBe('https://context.reverso.net/translation/portuguese-russian/trem')
  })

  it('encodes spaces in query templates', () => {
    const url = buildDictionaryUrl(
      d('https://translate.google.com/?sl=pt&tl=ru&text={word}&op=translate'),
      'de repente',
    )
    expect(url).toContain('text=de%20repente&op=translate')
  })

  it('encodes reserved characters so they cannot change the URL structure', () => {
    expect(buildDictionaryUrl(d('https://x.org/{word}'), 'a/b?c#d&e')).toBe(
      'https://x.org/a%2Fb%3Fc%23d%26e',
    )
  })

  it('replaces slashes with spaces for no_slash encoding', () => {
    expect(
      buildDictionaryUrl(
        d('https://www.deepl.com/translator#en/ru/{word}', 'no_slash'),
        'take off/on',
      ),
    ).toBe('https://www.deepl.com/translator#en/ru/take%20off%20on')
  })

  it('replaces every occurrence of the placeholder', () => {
    expect(buildDictionaryUrl(d('https://x.org/{word}/?q={word}'), 'ab')).toBe(
      'https://x.org/ab/?q=ab',
    )
  })

  it('rejects non-http schemes', () => {
    expect(buildDictionaryUrl(d('javascript:alert(1)//{word}'), 'x')).toBeNull()
    expect(buildDictionaryUrl(d('data:text/html,{word}'), 'x')).toBeNull()
  })

  it('rejects a template without a placeholder', () => {
    expect(buildDictionaryUrl(d('https://x.org/'), 'x')).toBeNull()
  })

  it('rejects a placeholder in the host, port or userinfo', () => {
    expect(buildDictionaryUrl(d('https://{word}.x.org/'), 'x')).toBeNull()
    expect(buildDictionaryUrl(d('https://x.org:{word}/'), 'x')).toBeNull()
    expect(buildDictionaryUrl(d('https://{word}@x.org/'), 'x')).toBeNull()
  })

  it('rejects stray braces', () => {
    expect(buildDictionaryUrl(d('https://x.org/{other}/{word}'), 'x')).toBeNull()
    expect(buildDictionaryUrl(d('https://x.org/{word}}'), 'x')).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(buildDictionaryUrl(d('https://x.org/{word}'), '   ')).toBeNull()
    expect(buildDictionaryUrl(d('https://x.org/{word}', 'no_slash'), ' / ')).toBeNull()
  })

  it('returns null for malformed unicode', () => {
    expect(buildDictionaryUrl(d('https://x.org/{word}'), '\uD800')).toBeNull()
  })
})
