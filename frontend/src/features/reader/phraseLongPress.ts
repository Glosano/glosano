/**
 * Long-press gesture that starts phrase selection on touch screens (FLQ-32.2).
 *
 * A finger held still on a word for LONG_PRESS_MS activates selection; moving
 * LONG_PRESS_TOLERANCE_PX or more before that is a scroll or swipe and cancels
 * it. A second finger always cancels.
 */

export const LONG_PRESS_MS = 400
export const LONG_PRESS_TOLERANCE_PX = 10

export type LongPressPhase = 'idle' | 'pending' | 'selecting'

export interface LongPress {
  readonly phase: LongPressPhase
  start(x: number, y: number, touches: number): void
  /** 'select' while selecting: the caller must preventDefault and update the range. */
  move(x: number, y: number, touches: number): 'none' | 'select'
  end(): 'none' | 'selected'
  cancel(): void
}

export function createLongPress(onActivate: () => void): LongPress {
  let phase: LongPressPhase = 'idle'
  let originX = 0
  let originY = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const reset = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    phase = 'idle'
  }

  return {
    get phase() {
      return phase
    },

    start(x, y, touches) {
      reset()
      if (touches !== 1) return
      originX = x
      originY = y
      phase = 'pending'
      timer = setTimeout(() => {
        timer = null
        phase = 'selecting'
        onActivate()
      }, LONG_PRESS_MS)
    },

    move(x, y, touches) {
      if (phase === 'idle') return 'none'
      if (touches !== 1) {
        reset()
        return 'none'
      }
      if (phase === 'selecting') return 'select'
      if (Math.hypot(x - originX, y - originY) >= LONG_PRESS_TOLERANCE_PX) reset()
      return 'none'
    },

    end() {
      const selected = phase === 'selecting'
      reset()
      return selected ? 'selected' : 'none'
    },

    cancel: reset,
  }
}
