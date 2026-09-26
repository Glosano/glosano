/**
 * Page-turn swipe recognition for the reader (FLQ-32.1).
 *
 * A forward swipe runs bulk-known (ADR-0005), so only a deliberate one-finger
 * horizontal gesture counts. Everything else — scrolling with a sideways
 * drift, pinch-zoom, panning a zoomed page, system edge-back gestures, touches
 * on controls, long-press text selection — must not turn the page.
 */

const EDGE_PX = 24
const AXIS_LOCK_PX = 10
const AXIS_RATIO = 2
const MIN_DISTANCE_PX = 60
const MIN_DISTANCE_RATIO = 0.18
const ZOOM_EPSILON = 1.01

/**
 * Elements whose touches belong to themselves. Words and phrases are
 * `span[role=button]` and deliberately NOT listed: a swipe that starts on the
 * text must still turn the page.
 */
export const SWIPE_CONTROL_SELECTOR = 'button, a, input, textarea, select, iframe, [contenteditable]'

export interface SwipeStart {
  x: number
  y: number
  touches: number
  onControl: boolean
  viewportWidth: number
  zoomScale: number
}

export type SwipeDirection = 'left' | 'right'

export interface SwipeTracker {
  start(input: SwipeStart): void
  move(x: number, y: number, touches: number): void
  end(x: number, y: number, hasSelection: boolean): SwipeDirection | null
  cancel(): void
}

interface Gesture {
  x: number
  y: number
  minDistance: number
  axis: 'none' | 'horizontal' | 'vertical'
}

export function createSwipeTracker(): SwipeTracker {
  let gesture: Gesture | null = null

  return {
    start({ x, y, touches, onControl, viewportWidth, zoomScale }) {
      gesture = null
      if (touches !== 1 || onControl || zoomScale > ZOOM_EPSILON) return
      if (x < EDGE_PX || x > viewportWidth - EDGE_PX) return
      gesture = {
        x,
        y,
        axis: 'none',
        minDistance: Math.max(MIN_DISTANCE_PX, MIN_DISTANCE_RATIO * viewportWidth),
      }
    },

    move(x, y, touches) {
      if (!gesture) return
      if (touches !== 1) {
        gesture = null
        return
      }
      if (gesture.axis !== 'none') return
      const dx = Math.abs(x - gesture.x)
      const dy = Math.abs(y - gesture.y)
      if (Math.max(dx, dy) < AXIS_LOCK_PX) return
      gesture.axis = dx >= AXIS_RATIO * dy ? 'horizontal' : 'vertical'
    },

    end(x, y, hasSelection) {
      const current = gesture
      gesture = null
      if (!current || current.axis === 'vertical' || hasSelection) return null
      const dx = x - current.x
      const dy = y - current.y
      if (Math.abs(dx) < current.minDistance) return null
      if (Math.abs(dx) < AXIS_RATIO * Math.abs(dy)) return null
      return dx < 0 ? 'left' : 'right'
    },

    cancel() {
      gesture = null
    },
  }
}
