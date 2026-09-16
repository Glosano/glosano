import { describe, expect, it } from 'vitest'
import { activeFragment, observePlayback, type Observation } from './playback'

describe('caption playback', () => {
  it('leaves gaps unhighlighted, including gaps inside a fragment', () => {
    const fragments = [
      {
        media_start_ms: 1000,
        media_end_ms: 4000,
        cue_intervals: [
          { start_ms: 1000, end_ms: 2000 },
          { start_ms: 3000, end_ms: 4000 },
        ],
      },
    ]
    expect(activeFragment(fragments, 1.5)).toBe(0)
    expect(activeFragment(fragments, 2.5)).toBe(-1)
    expect(activeFragment(fragments, 4)).toBe(-1)
  })
  it('recognizes a natural boundary and a seek separately', () => {
    const previous: Observation = { time: 9.9, wall: 1000, rate: 1 }
    expect(
      observePlayback(previous, { time: 10.02, wall: 1120, rate: 1 }, { start: 0, end: 10 }),
    ).toBe('boundary')
    expect(
      observePlayback(previous, { time: 22, wall: 1120, rate: 1 }, { start: 0, end: 10 }),
    ).toBe('seek')
  })
  it('treats suspended polling or changed speed conservatively', () => {
    const previous: Observation = { time: 9.9, wall: 1000, rate: 1 }
    expect(
      observePlayback(previous, { time: 12, wall: 3100, rate: 1 }, { start: 0, end: 10 }),
    ).toBe('seek')
    expect(
      observePlayback(previous, { time: 10, wall: 1100, rate: 2 }, { start: 0, end: 10 }),
    ).toBe('seek')
    expect(
      observePlayback(
        { ...previous, rate: 2 },
        { time: 10.1, wall: 1100, rate: 2 },
        { start: 0, end: 10 },
      ),
    ).toBe('boundary')
  })
  it('never assumes a boundary is natural without a previous observation', () => {
    expect(observePlayback(null, { time: 12, wall: 1000, rate: 1 }, { start: 0, end: 10 })).toBe(
      'seek',
    )
  })
})
