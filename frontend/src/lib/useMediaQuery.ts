import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query. `fallback` is used where `matchMedia` is
 * unavailable (jsdom, SSR), so tests render the desktop layout by default.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? fallback
      : window.matchMedia(query).matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Phone-width layout: below Tailwind's `md` breakpoint. */
export const COMPACT_QUERY = '(max-width: 767px)'
/** Phone-width screens tall enough to keep the video pinned above the text. */
export const PINNED_VIDEO_QUERY = '(max-width: 767px) and (min-height: 560px)'
/** Screens wide enough that the minimum-size video is noticeably smaller than full width. */
export const MINI_VIDEO_QUERY = '(min-width: 480px)'
/** Touch-first input: on-screen keyboards make Enter-to-send error-prone. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)'
