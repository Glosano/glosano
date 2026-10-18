import type { ExternalDictionary } from '@/api/externalDictionaries'

const PLACEHOLDER = '{word}'
const SENTINEL_A = 'wqzxaplaceholder1'
const SENTINEL_B = 'wqzxbplaceholder2'

/** Origin-like parts of a URL after substituting `word` for the placeholder. */
function authority(template: string, word: string): string | null {
  try {
    const u = new URL(template.split(PLACEHOLDER).join(word))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.username}:${u.password}@${u.host}`
  } catch {
    return null
  }
}

/** Frontend mirror of the backend template rules (spec §5). */
function isSafeTemplate(template: string): boolean {
  if (!template.includes(PLACEHOLDER)) return false
  if (/[{}]/.test(template.split(PLACEHOLDER).join(''))) return false
  const a = authority(template, SENTINEL_A)
  const b = authority(template, SENTINEL_B)
  if (a === null || b === null || a !== b) return false
  return !a.includes(SENTINEL_A) && !a.includes(SENTINEL_B)
}

export function buildDictionaryUrl(
  d: Pick<ExternalDictionary, 'url_template' | 'word_encoding'>,
  text: string,
): string | null {
  if (!isSafeTemplate(d.url_template)) return null
  const prepared = d.word_encoding === 'no_slash' ? text.replace(/\//g, ' ') : text
  const word = prepared.trim()
  if (!word) return null
  try {
    return d.url_template.split(PLACEHOLDER).join(encodeURIComponent(word))
  } catch {
    // encodeURIComponent throws URIError on a lone surrogate.
    return null
  }
}
