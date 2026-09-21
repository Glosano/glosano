import { ApiError } from '@/api/client'

export const DRAFT_TEXT_LIMIT = 16000

export function fencedQuote(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length)
  const fence = '`'.repeat(Math.max(3, ...runs.map((length) => length + 1)))
  return `${fence}\n${text}\n${fence}`
}

export function containsQuote(text: string, paragraph: string): boolean {
  return text.includes(fencedQuote(paragraph))
}

export function appendQuotes(text: string, paragraphs: string[]): string {
  let result = text
  for (const paragraph of paragraphs) {
    if (containsQuote(result, paragraph)) continue
    result += `${result ? (result.endsWith('\n\n') ? '' : result.endsWith('\n') ? '\n' : '\n\n') : ''}${fencedQuote(paragraph)}\n\n`
  }
  if (Array.from(result).length > DRAFT_TEXT_LIMIT)
    throw new ApiError(422, 'inline_quote_too_large')
  return result
}

// Match Markdown backtick fences, including the longer fences used for source backticks.
export function questionOutsideQuotes(text: string): string {
  let fenceLength = 0
  const question: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (fenceLength) {
      const close = /^ {0,3}(`{3,})[ \t]*$/.exec(line)
      if (close && close[1]!.length >= fenceLength) fenceLength = 0
    } else {
      const open = /^ {0,3}(`{3,})[^`]*$/.exec(line)
      if (open) fenceLength = open[1]!.length
      else question.push(line)
    }
  }
  return question.join('\n').trim()
}
