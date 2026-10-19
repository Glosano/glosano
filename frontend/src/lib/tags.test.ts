import { describe, expect, it } from 'vitest'

import { translate } from './i18n'
import { parseTagInput, tagInputError } from './tags'

describe('parseTagInput', () => {
  it('splits on ASCII and CJK separators, trims, lowercases and dedupes', () => {
    expect(parseTagInput(' News , b2;подкаст，漫画、日本語；news ,, ')).toEqual([
      'news',
      'b2',
      'подкаст',
      '漫画',
      '日本語',
    ])
  })

  it('collapses inner whitespace', () => {
    expect(parseTagInput('grammar   B2')).toEqual(['grammar b2'])
  })
})

describe('tagInputError', () => {
  it('accepts the limits and reports the first broken rule', () => {
    expect(tagInputError(['x'.repeat(40)])).toBeNull()
    expect(tagInputError(['x'.repeat(41)])).toBe('A tag must be at most 40 characters.')
    expect(tagInputError(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe(
      'No more than 20 tags per material.',
    )
  })

  it('has Russian text for both limit messages', () => {
    const tooLong = tagInputError(['x'.repeat(41)])!
    const tooMany = tagInputError(Array.from({ length: 21 }, (_, i) => `t${i}`))!
    expect(translate(tooLong, undefined, 'ru')).toBe('Тег должен быть не длиннее 40 символов.')
    expect(translate(tooMany, undefined, 'ru')).toBe('Не больше 20 тегов на материал.')
  })
})
