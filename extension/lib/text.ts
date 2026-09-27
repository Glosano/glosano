/** Cuts `value` to at most `max` Unicode code points, so a surrogate pair is never split. */
export function truncateCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}
