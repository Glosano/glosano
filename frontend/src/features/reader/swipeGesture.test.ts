import { describe, expect, it } from 'vitest'

import { createSwipeTracker, type SwipeStart } from './swipeGesture'

type Point = [x: number, y: number, touches?: number]

/** Runs one gesture that starts at (100, 300) unless `start` overrides it. */
function run(
  moves: Point[],
  end: [number, number],
  { start = {}, hasSelection = false }: { start?: Partial<SwipeStart>; hasSelection?: boolean } = {},
) {
  const tracker = createSwipeTracker()
  tracker.start({
    x: 100,
    y: 300,
    touches: 1,
    onControl: false,
    viewportWidth: 375,
    zoomScale: 1,
    ...start,
  })
  for (const [x, y, touches = 1] of moves) tracker.move(x, y, touches)
  return tracker.end(end[0], end[1], hasSelection)
}

describe('createSwipeTracker', () => {
  it('recognises a deliberate horizontal swipe in both directions', () => {
    expect(run([[80, 302], [0, 305]], [0, 305])).toBe('left')
    expect(run([[120, 298], [200, 296]], [200, 296])).toBe('right')
  })

  it('requires 18% of the viewport width, but never less than 60px', () => {
    // 375px viewport -> 67.5px threshold.
    expect(run([[80, 300], [50, 300]], [50, 300])).toBeNull()
    expect(run([[80, 300], [30, 300]], [30, 300])).toBe('left')
    // 300px viewport -> 54px, clamped up to 60px.
    expect(run([[80, 300], [45, 300]], [45, 300], { start: { viewportWidth: 300 } })).toBeNull()
    expect(run([[80, 300], [40, 300]], [40, 300], { start: { viewportWidth: 300 } })).toBe('left')
  })

  it('locks to vertical when the finger first moves mostly vertically', () => {
    // Scroll that starts vertical and drifts sideways later must never turn the page.
    expect(run([[100, 315], [-20, 320]], [-20, 320])).toBeNull()
  })

  it('rejects diagonal gestures steeper than |dx| >= 2|dy|', () => {
    expect(run([[80, 290], [0, 240]], [0, 240])).toBeNull()
    expect(run([[80, 295], [0, 255]], [0, 255])).toBe('left')
  })

  it('ignores multi-touch gestures such as pinch-zoom', () => {
    expect(run([[80, 300, 2], [0, 300, 2]], [0, 300])).toBeNull()
    expect(run([[80, 300], [0, 300]], [0, 300], { start: { touches: 2 } })).toBeNull()
  })

  it('leaves the screen edges to system back gestures', () => {
    expect(run([[40, 300], [110, 300]], [110, 300], { start: { x: 10 } })).toBeNull()
    expect(run([[340, 300], [270, 300]], [270, 300], { start: { x: 360 } })).toBeNull()
  })

  it('ignores gestures that start on controls or on a zoomed page', () => {
    expect(run([[80, 300], [0, 300]], [0, 300], { start: { onControl: true } })).toBeNull()
    expect(run([[80, 300], [0, 300]], [0, 300], { start: { zoomScale: 1.5 } })).toBeNull()
  })

  it('ignores the gesture when text is selected at release', () => {
    expect(run([[80, 300], [0, 300]], [0, 300], { hasSelection: true })).toBeNull()
  })

  it('forgets a cancelled gesture and accepts the next one', () => {
    const tracker = createSwipeTracker()
    const start = { x: 100, y: 300, touches: 1, onControl: false, viewportWidth: 375, zoomScale: 1 }
    tracker.start(start)
    tracker.move(20, 300, 1)
    tracker.cancel()
    expect(tracker.end(0, 300, false)).toBeNull()
    tracker.start({ ...start, onControl: true })
    expect(tracker.end(0, 300, false)).toBeNull()
    tracker.start(start)
    tracker.move(20, 300, 1)
    expect(tracker.end(0, 300, false)).toBe('left')
  })
})
