import type { LessonVocabularyItem } from '@/api/reader'

import type { SelectedItem } from './selectedItem'

export type VocabularyTab = 'added' | 'new' | 'all'

export function vocabularyRowKey(item: LessonVocabularyItem): string {
  return `${item.kind}:${item.text}`
}

export function toSelectedVocabularyItem(item: LessonVocabularyItem): SelectedItem {
  return {
    kind: item.kind,
    t: item.display_text,
    n: item.text,
    i: item.context?.token_ordinal ?? null,
    segmentId: item.context?.segment_id ?? null,
    sentenceText: item.context?.sentence_text ?? null,
  }
}

export function selectVocabularyItems(
  items: LessonVocabularyItem[],
  tab: VocabularyTab,
  lang: string,
): LessonVocabularyItem[] {
  const collator = new Intl.Collator(lang)
  return items
    .filter((item) =>
      tab === 'added' ? item.added_here : tab === 'new' ? item.status === 'new' : true,
    )
    .sort(
      (a, b) =>
        collator.compare(a.text, b.text) ||
        a.kind.localeCompare(b.kind) ||
        (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
    )
}
