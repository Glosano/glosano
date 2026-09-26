import { useEffect, useRef, useState } from 'react'

import { isWord, type Sentence } from '@/api/reader'

import { createLongPress } from './phraseLongPress'
import { buildSelection } from './phraseMatching'
import { anchorAt, clampRange, MAX_PHRASE_WORDS, type Anchor, type DragRange } from './usePhraseSelection'

interface Params {
  enabled: boolean
  sentences: Sentence[]
  /**
   * The text container element (from a callback ref). Listeners follow the
   * element itself: the reader mounts the text only after the results screen
   * is dismissed, so a ref read on first render would stay empty.
   */
  container: HTMLElement | null
  onSelect: (range: DragRange, sentence: Sentence) => void
  onWordTap: (word: { t: string; n: string; i: number }) => void
  /** Selection has started: the caller must drop competing gestures (swipe). */
  onActivate: () => void
}

export interface TouchPhrasePreview {
  text: string
  /** The finger is past the 8-word limit or outside the start word's sentence. */
  limited: boolean
}

function ordinalOf(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-ordinal]') : null
  if (!el) return null
  const value = Number(el.dataset.ordinal)
  return Number.isFinite(value) ? value : null
}

function previewFor(anchor: Anchor, range: DragRange, target: number): TouchPhrasePreview {
  const anchorIndex = anchor.wordOrdinals.indexOf(anchor.ordinal)
  const targetIndex = anchor.wordOrdinals.indexOf(target)
  return {
    text: buildSelection(anchor.sentence, range.from, range.to)?.displayText ?? '',
    limited: targetIndex === -1 || Math.abs(targetIndex - anchorIndex) > MAX_PHRASE_WORDS - 1,
  }
}

/**
 * Phrase selection on touch screens (FLQ-32.2): hold a word, then drag across
 * the sentence. Native listeners are required because React's touch handlers
 * are passive and cannot stop the page from scrolling while selecting.
 */
export function useTouchPhraseSelection(params: Params) {
  const [touchRange, setTouchRange] = useState<DragRange | null>(null)
  const [preview, setPreview] = useState<TouchPhrasePreview | null>(null)
  const latest = useRef(params)
  latest.current = params
  const { container, enabled } = params

  useEffect(() => {
    if (!container || !enabled) return

    let anchor: Anchor | null = null
    let range: DragRange | null = null
    let suppressClick = false

    const clear = () => {
      anchor = null
      range = null
      setTouchRange(null)
      setPreview(null)
    }

    const longPress = createLongPress(() => {
      if (!anchor) return
      range = { from: anchor.ordinal, to: anchor.ordinal }
      setTouchRange(range)
      setPreview(previewFor(anchor, range, anchor.ordinal))
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10)
      latest.current.onActivate()
    })

    const onTouchStart = (event: TouchEvent) => {
      suppressClick = false
      clear()
      const ordinal = ordinalOf(event.target)
      anchor = ordinal === null ? null : anchorAt(latest.current.sentences, ordinal)
      const first = event.touches[0]
      if (!anchor || !first) {
        longPress.cancel()
        return
      }
      longPress.start(first.clientX, first.clientY, event.touches.length)
    }

    const onTouchMove = (event: TouchEvent) => {
      const first = event.touches[0]
      if (!first) return
      if (longPress.move(first.clientX, first.clientY, event.touches.length) !== 'select') {
        if (longPress.phase === 'idle' && range) clear()
        return
      }
      // A native scroll already under way (browser slop is below our tolerance)
      // makes the move non-cancelable: the page keeps scrolling, so give up
      // rather than select words under a moving page.
      if (!event.cancelable) {
        longPress.cancel()
        clear()
        return
      }
      event.preventDefault()
      if (!anchor) return
      const hit = document.elementFromPoint?.(first.clientX, first.clientY) ?? null
      const target = ordinalOf(hit)
      if (target === null) return
      range = clampRange(anchor, target)
      setTouchRange(range)
      setPreview(previewFor(anchor, range, target))
    }

    const onTouchEnd = () => {
      const wasSelecting = longPress.end() === 'selected'
      const done = { anchor, range }
      clear()
      if (!wasSelecting || !done.anchor || !done.range) return
      suppressClick = true
      if (done.range.to > done.range.from) {
        latest.current.onSelect(done.range, done.anchor.sentence)
        return
      }
      const ordinal = done.anchor.ordinal
      const word = done.anchor.sentence.tokens.find((tok) => isWord(tok) && tok.i === ordinal)
      if (word && isWord(word)) latest.current.onWordTap(word)
    }

    const onTouchCancel = () => {
      longPress.cancel()
      clear()
    }

    const onScroll = () => {
      if (longPress.phase === 'pending') longPress.cancel()
    }

    // Android opens a context menu on long-press; the hold belongs to selection.
    const onContextMenu = (event: MouseEvent) => {
      if (ordinalOf(event.target) !== null) event.preventDefault()
    }

    // The browser may synthesise a click after the release; it must not open a
    // word card on top of the one the selection just opened.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchCancel)
    container.addEventListener('contextmenu', onContextMenu)
    container.addEventListener('click', onClickCapture, true)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      longPress.cancel()
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchCancel)
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('click', onClickCapture, true)
      setTouchRange(null)
      setPreview(null)
    }
  }, [container, enabled])

  return { touchRange, preview }
}
