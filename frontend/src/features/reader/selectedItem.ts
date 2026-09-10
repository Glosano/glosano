export interface SelectedItem {
  kind: 'token' | 'phrase'
  /** Display text: слово как в тексте / срез фразы с пунктуацией. */
  t: string
  /** Нормализованный join key: token.n / слова фразы через пробел. */
  n: string
  /** Ординал (первого) слова — для поиска предложения и позиционирования. */
  i: number | null
  /** Explicit source segment for selections created outside the visible page. */
  segmentId?: string | null
  /** Для фразы контекст захватывается при выделении; для токена null
      (ReaderPage выводит его по ординалу). */
  sentenceText: string | null
}
