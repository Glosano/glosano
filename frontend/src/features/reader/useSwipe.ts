import { useRef } from 'react'
import type { TouchEvent } from 'react'

import { createSwipeTracker, SWIPE_CONTROL_SELECTOR } from './swipeGesture'

interface Params {
  onSwipeLeft: () => void
  onSwipeRight: () => void
}

/** Feeds touch events into the page-turn recogniser; see swipeGesture.ts for the rules. */
export function useSwipe({ onSwipeLeft, onSwipeRight }: Params) {
  const tracker = useRef(createSwipeTracker())

  const onTouchStart = (event: TouchEvent) => {
    const first = event.touches[0]
    if (!first) return
    const target = event.target
    tracker.current.start({
      x: first.clientX,
      y: first.clientY,
      touches: event.touches.length,
      onControl: target instanceof Element && target.closest(SWIPE_CONTROL_SELECTOR) !== null,
      viewportWidth: window.innerWidth,
      zoomScale: window.visualViewport?.scale ?? 1,
    })
  }

  const onTouchMove = (event: TouchEvent) => {
    const first = event.touches[0]
    if (!first) return
    tracker.current.move(first.clientX, first.clientY, event.touches.length)
  }

  const onTouchEnd = (event: TouchEvent) => {
    const last = event.changedTouches[0]
    if (!last) {
      tracker.current.cancel()
      return
    }
    const hasSelection = !!window.getSelection()?.toString()
    const direction = tracker.current.end(last.clientX, last.clientY, hasSelection)
    if (direction === 'left') onSwipeLeft()
    else if (direction === 'right') onSwipeRight()
  }

  const onTouchCancel = () => tracker.current.cancel()

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
