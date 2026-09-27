import { describe, expect, it } from 'vitest'

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
    expect(tagInputError(['x'.repeat(41)])).toBe('Тег должен быть не длиннее 40 символов.')
    expect(tagInputError(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe(
      'Не больше 20 тегов на материал.',
    )
  })
})
