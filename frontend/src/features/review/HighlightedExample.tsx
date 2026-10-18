import type { ReactNode } from 'react'

// Apostrophes and hyphens only join a word when they are internal.
const wordBefore = /[\p{L}\p{M}\p{N}_][-’']*$/u
const wordAfter = /^[-’']*[\p{L}\p{M}\p{N}_]/u

export function HighlightedExample({
  sentence,
  word,
  lang,
}: {
  sentence: string
  word: string
  lang: string
}) {
  const text = sentence.normalize('NFC')
  const term = word.normalize('NFC').trim()
  if (!term) return text

  const literal = term
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const matches = text.matchAll(new RegExp(literal, 'giu'))
  const parts: ReactNode[] = []
  let offset = 0

  for (const match of matches) {
    const start = match.index
    const end = start + match[0].length
    // Chinese and Japanese examples do not have spaces between words.
    if (
      lang !== 'zh-Hans' &&
      lang !== 'ja' &&
      (wordBefore.test(text.slice(0, start)) || wordAfter.test(text.slice(end)))
    ) {
      continue
    }
    parts.push(text.slice(offset, start))
    parts.push(
      <mark key={start} className="rounded-sm bg-green-100 font-semibold text-green-800">
        {match[0]}
      </mark>,
    )
    offset = end
  }
  parts.push(text.slice(offset))
  return <>{parts}</>
}
