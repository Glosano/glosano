import { describe, expect, it } from 'vitest'

import type { LessonVocabularyItem } from '@/api/reader'

import {
  selectVocabularyItems,
  toSelectedVocabularyItem,
  vocabularyRowKey,
  type VocabularyTab,
} from './lessonVocabulary'

const base: LessonVocabularyItem = {
  kind: 'token',
  item_id: 'one',
  text: 'casa',
  display_text: 'Casa',
  status: 'tracked',
  confidence: 0,
  added_here: true,
  primary_translation: null,
  context: null,
}

it('uses provenance for added and missing state for new', () => {
  const items: LessonVocabularyItem[] = [
    base,
    { ...base, item_id: 'two', text: 'rua', status: 'known', confidence: null },
    {
      ...base,
      item_id: null,
      text: 'praça',
      status: 'new',
      confidence: null,
      added_here: false,
    },
    { ...base, item_id: 'four', text: 'antigo', added_here: false },
  ]

  expect(selectVocabularyItems(items, 'new', 'pt').map((item) => item.text)).toEqual(['praça'])
  expect(selectVocabularyItems(items, 'added', 'pt').map((item) => item.text)).toEqual([
    'casa',
    'rua',
  ])
  expect(selectVocabularyItems(items, 'all', 'pt')).toHaveLength(4)
})

it('keeps ignored items in added when their provenance belongs to the lesson', () => {
  const ignored: LessonVocabularyItem = {
    ...base,
    item_id: 'ignored',
    status: 'ignored',
    confidence: null,
  }

  expect(selectVocabularyItems([ignored], 'added', 'pt')).toEqual([ignored])
  expect(selectVocabularyItems([ignored], 'new', 'pt')).toEqual([])
})

it('keeps token and phrase rows distinct when their normalized text matches', () => {
  const phrase: LessonVocabularyItem = { ...base, kind: 'phrase', item_id: 'phrase-one' }

  expect(vocabularyRowKey(base)).toBe('token:casa')
  expect(vocabularyRowKey(phrase)).toBe('phrase:casa')
  expect(selectVocabularyItems([base, phrase], 'all', 'pt')).toHaveLength(2)
})

describe.each<{
  lang: string
  values: string[]
  expected: string[]
}>([
  { lang: 'ru', values: ['банан', 'арбуз'], expected: ['арбуз', 'банан'] },
  { lang: 'en', values: ['zebra', 'apple'], expected: ['apple', 'zebra'] },
  { lang: 'pt', values: ['casa', 'ação'], expected: ['ação', 'casa'] },
])('locale sorting for $lang', ({ lang, values, expected }) => {
  it('sorts a copy without mutating the source snapshot', () => {
    const items = values.map((text, index) => ({
      ...base,
      item_id: `item-${index}`,
      text,
      display_text: text,
    }))
    const originalOrder = items.map((item) => item.text)

    expect(
      selectVocabularyItems(items, 'all' satisfies VocabularyTab, lang).map((item) => item.text),
    ).toEqual(expected)
    expect(items.map((item) => item.text)).toEqual(originalOrder)
  })
})

it('maps the explicit vocabulary context without inventing a reader position', () => {
  expect(
    toSelectedVocabularyItem({
      ...base,
      context: { segment_id: 'seg-1', token_ordinal: 0, sentence_text: 'Casa azul.' },
    }),
  ).toEqual({
    kind: 'token',
    t: 'Casa',
    n: 'casa',
    i: 0,
    segmentId: 'seg-1',
    sentenceText: 'Casa azul.',
  })

  expect(toSelectedVocabularyItem({ ...base, context: null })).toEqual({
    kind: 'token',
    t: 'Casa',
    n: 'casa',
    i: null,
    segmentId: null,
    sentenceText: null,
  })
})
