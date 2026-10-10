import { expect, it } from 'vitest'
import { normalizeFillAnswer } from './fillAnswer'

it.each([
  ['  CAFÉ  ', 'cafe\u0301', true],
  ['BOM   DIA', 'bom dia', true],
  ['cafE', 'café', false],
  ["l'amour", 'l’amour', false],
  ['well-known', 'wellknown', false],
  ['walked', 'walk', false],
  [' слово! ', 'слово', false],
  ['日本語', '日本語', true],
  ['سلام', 'سلام', true],
])('compares %s to %s preserving the studied form', (actual, expected, equal) => {
  expect(normalizeFillAnswer(actual) === normalizeFillAnswer(expected)).toBe(equal)
})
