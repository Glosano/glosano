import { parseTagInput, tagInputError } from './tags'

describe('parseTagInput', () => {
  it('splits, trims, lowercases and dedupes like the server', () => {
    expect(parseTagInput(' News , b2;подкаст，漫画、news ,, ')).toEqual(['news', 'b2', 'подкаст', '漫画'])
  })
})

describe('tagInputError', () => {
  it('reports the limits', () => {
    expect(tagInputError(['x'.repeat(40)])).toBeNull()
    expect(tagInputError(['x'.repeat(41)])).toBe('error_tag_too_long')
    expect(tagInputError(Array.from({ length: 21 }, (_, i) => `t${i}`))).toBe('error_too_many_tags')
  })
})
