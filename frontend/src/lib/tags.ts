export const MAX_TAG_LENGTH = 40
export const MAX_TAGS = 20

const SEPARATORS = /[,;，、；]/

/** Splits "News, b2" into tags the way the server normalizes them (ADR-0026). */
export function parseTagInput(value: string): string[] {
  const tags: string[] = []
  for (const piece of value.split(SEPARATORS)) {
    const tag = piece.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** The i18n key of the first limit the tags break, or null. The server checks again. */
export function tagInputError(tags: string[]): string | null {
  if (tags.some((tag) => [...tag].length > MAX_TAG_LENGTH))
    return 'Тег должен быть не длиннее 40 символов.'
  if (tags.length > MAX_TAGS) return 'Не больше 20 тегов на материал.'
  return null
}
