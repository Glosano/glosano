/** The video player that stays on screen above the lesson text on phones. */
export const PINNED_VIDEO_SELECTOR = '[data-video-pinned]'

/** Viewport bottom of the pinned player, or 0 when nothing is pinned. */
export function pinnedVideoBottom(): number {
  const player = document.querySelector(PINNED_VIDEO_SELECTOR)
  return player ? Math.max(0, player.getBoundingClientRect().bottom) : 0
}
