/** Preserve the studied surface form: no accent, punctuation or morphology folding. */
export function normalizeFillAnswer(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ')
}
