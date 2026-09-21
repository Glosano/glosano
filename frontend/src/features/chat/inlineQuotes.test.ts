import { expect, it } from 'vitest'
import { appendQuotes, containsQuote, fencedQuote, questionOutsideQuotes } from './inlineQuotes'

it('uses a longer fence than any source backtick run and preserves source bytes', () => {
  const source = 'A  paragraph.\n``` nested ``` and ````.'
  expect(fencedQuote(source)).toBe('`````\n' + source + '\n`````')
  expect(appendQuotes('Question?', [source])).toBe('Question?\n\n`````\n' + source + '\n`````\n\n')
})
it.each([
  ['Ordinary unfenced text', 'Ordinary unfenced text'],
  ['Question first\n\n```\nQuote\n```', 'Question first'],
  ['```\nOne\n```\n\n```\nTwo\n```\nQuestion', 'Question'],
  ['````\n```\nsource\n```\n````\nQuestion', 'Question'],
  ['```\nUnclosed quote', ''],
  ['Use `code` here', 'Use `code` here'],
])('extracts the question consistently from %s', (text, expected) => {
  expect(questionOutsideQuotes(text)).toBe(expected)
})
it('deduplicates intact blocks but permits readding after editing or removing them', () => {
  const initial = appendQuotes('', ['Exact paragraph'])
  expect(appendQuotes(initial, ['Exact paragraph'])).toBe(initial)
  const edited = initial.replace('Exact', 'Edited')
  expect(containsQuote(edited, 'Exact paragraph')).toBe(false)
  expect(appendQuotes(edited, ['Exact paragraph'])).toContain('Edited paragraph')
  expect(containsQuote(appendQuotes(edited, ['Exact paragraph']), 'Exact paragraph')).toBe(true)
  expect(containsQuote('', 'Exact paragraph')).toBe(false)
})
it('rejects oversized insertion without trimming user content', () => {
  expect(() => appendQuotes('Q'.repeat(15990), ['Quote'])).toThrow('inline_quote_too_large')
})
