import type { MessageKey } from './i18n'

export const MAX_TAG_LENGTH = 40
export const MAX_TAGS = 20

const SEPARATORS = /[,;，、；]/

/** Splits "News, b2" into tags the way the Glosano server normalizes them (ADR-0026). */
export function parseTagInput(value: string): string[] {
  const tags: string[] = []
  for (const piece of value.split(SEPARATORS)) {
    const tag = piece.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

export function tagInputError(tags: string[]): MessageKey | null {
  if (tags.some((tag) => Array.from(tag).length > MAX_TAG_LENGTH)) return 'error_tag_too_long'
  if (tags.length > MAX_TAGS) return 'error_too_many_tags'
  return null
}
