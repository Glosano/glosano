import type { Sentence } from '@/api/reader'

export interface Interval {
  start: number
  end: number
}
export interface Observation {
  time: number
  wall: number
  rate: number
}

export function activeFragment(
  fragments: Pick<Sentence, 'media_start_ms' | 'media_end_ms' | 'cue_intervals'>[],
  time: number,
): number {
  const ms = time * 1000
  return fragments.findIndex(
    (fragment) =>
      fragment.media_start_ms != null &&
      fragment.media_end_ms != null &&
      ms >= fragment.media_start_ms &&
      ms < fragment.media_end_ms &&
      (!fragment.cue_intervals?.length ||
        fragment.cue_intervals.some((cue) => ms >= cue.start_ms && ms < cue.end_ms)),
  )
}

export function intervalFor(sentences: Sentence[]): Interval | null {
  const start = sentences[0]?.media_start_ms
  const end = sentences.at(-1)?.media_end_ms
  return start != null && end != null && end > start
    ? { start: start / 1000, end: end / 1000 }
    : null
}

export function observePlayback(
  previous: Observation | null,
  next: Observation,
  interval: Interval,
): 'playing' | 'seek' | 'boundary' {
  if (!previous)
    return next.time < interval.start - 0.15 || next.time >= interval.end ? 'seek' : 'playing'
  const elapsed = (next.wall - previous.wall) / 1000
  const advance = next.time - previous.time
  // An interrupted clock, buffering or speed change cannot justify a vocabulary write.
  if (
    elapsed > 0.75 ||
    elapsed < 0 ||
    next.rate !== previous.rate ||
    advance < -0.15 ||
    Math.abs(advance - elapsed * next.rate) > 0.45
  )
    return 'seek'
  return next.time >= interval.end ? 'boundary' : 'playing'
}
