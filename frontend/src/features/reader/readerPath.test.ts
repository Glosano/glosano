import { expect, it } from 'vitest'
import { isReaderPath } from './readerPath'

it.each([
  ['/learn/en/lessons/abc', true],
  ['/learn/pt/lessons/abc/', true],
  ['/learn/en/lessons/abc/edit', false],
  ['/learn/en/library', false],
  ['/learn/en/vocabulary', false],
  ['/learn/en/lessons', false],
])('isReaderPath(%s) is %s', (path, expected) => {
  expect(isReaderPath(path)).toBe(expected)
})
