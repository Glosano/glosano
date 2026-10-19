import { msg } from '@/lib/i18n'

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
    return msg('A tag must be at most 40 characters.')
  if (tags.length > MAX_TAGS) return msg('No more than 20 tags per material.')
  return null
}
