import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sentence, Token } from '@/api/reader'

import { LONG_PRESS_MS } from './phraseLongPress'
import { useTouchPhraseSelection } from './useTouchPhraseSelection'

function sentence(seg: string, first: number, count: number): Sentence {
  const tokens: Token[] = []
  for (let k = 0; k < count; k += 1) {
    if (k > 0) tokens.push({ ws: ' ' })
    tokens.push({ t: `W${first + k}`, n: `w${first + k}`, i: first + k })
  }
  return {
    seg_id: seg,
    index: 0,
    text: tokens.map((t) => ('t' in t ? t.t : ' ')).join(''),
    normalized_text: '',
    tokens,
  }
}

// Sentence A: ordinals 0..11, sentence B: 12..13.
const sentences = [sentence('a', 0, 12), sentence('b', 12, 2)]

const onSelect = vi.fn()
const onWordTap = vi.fn()
const onActivate = vi.fn()
const onWordClick = vi.fn()

function Harness() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const { touchRange, preview } = useTouchPhraseSelection({
    enabled: true,
    sentences,
    container: el,
    onSelect,
    onWordTap,
    onActivate,
  })
  return (
    <div>
      <div ref={setEl} data-testid="text">
        {sentences.flatMap((s) =>
          s.tokens.map((tok, k) =>
            't' in tok ? (
              <span key={`${s.seg_id}-${k}`} data-ordinal={tok.i} onClick={() => onWordClick(tok.i)}>
                {tok.t}
              </span>
            ) : (
              <span key={`${s.seg_id}-${k}`}> </span>
            ),
          ),
        )}
      </div>
      <output data-testid="range">{touchRange ? `${touchRange.from}-${touchRange.to}` : ''}</output>
      <output data-testid="preview">{preview ? `${preview.text}|${preview.limited}` : ''}</output>
    </div>
  )
}

const word = (i: number) => screen.getByText(`W${i}`)
const x = (i: number) => i * 10 + 5
const point = (i: number, dy = 0) => ({ clientX: x(i), clientY: 100 + dy })

function press(i: number) {
  fireEvent.touchStart(word(i), { touches: [point(i)], changedTouches: [point(i)] })
}
function hold() {
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS)
  })
}
function moveTo(i: number, dy = 0) {
  return fireEvent.touchMove(word(0), { touches: [point(i, dy)], changedTouches: [point(i, dy)] })
}
function release(i: number) {
  fireEvent.touchEnd(word(i), { touches: [], changedTouches: [point(i)] })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  document.elementFromPoint = vi.fn((px: number) => {
    const ordinal = Math.floor(px / 10)
    return document.querySelector(`[data-ordinal="${ordinal}"]`)
  })
  render(<Harness />)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTouchPhraseSelection', () => {
  it('selects a phrase by holding a word and dragging across the sentence', () => {
    press(1)
    hold()
    expect(onActivate).toHaveBeenCalledOnce()
    expect(screen.getByTestId('range')).toHaveTextContent('1-1')
    expect(moveTo(3)).toBe(false) // default prevented: no scrolling while selecting
    expect(screen.getByTestId('range')).toHaveTextContent('1-3')
    expect(screen.getByTestId('preview')).toHaveTextContent('W1 W2 W3|false')
    release(3)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith({ from: 1, to: 3 }, sentences[0])
    expect(onWordTap).not.toHaveBeenCalled()
    expect(screen.getByTestId('range')).toHaveTextContent('')
    expect(screen.getByTestId('preview')).toHaveTextContent('')
  })

  it('opens the word card once when released on the start word', () => {
    press(2)
    hold()
    moveTo(4)
    moveTo(2)
    release(2)
    expect(onWordTap).toHaveBeenCalledWith({ t: 'W2', n: 'w2', i: 2 })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(word(2))
    expect(onWordClick).not.toHaveBeenCalled()
  })

  it('suppresses only the click synthesised after the release', () => {
    press(1)
    hold()
    moveTo(3)
    release(3)
    fireEvent.click(word(3))
    expect(onWordClick).not.toHaveBeenCalled()
    fireEvent.touchStart(word(5), { touches: [point(5)], changedTouches: [point(5)] })
    fireEvent.touchEnd(word(5), { touches: [], changedTouches: [point(5)] })
    fireEvent.click(word(5))
    expect(onWordClick).toHaveBeenCalledWith(5)
  })

  it('caps the phrase at eight words and flags the limit in the preview', () => {
    press(0)
    hold()
    moveTo(11)
    expect(screen.getByTestId('range')).toHaveTextContent('0-7')
    expect(screen.getByTestId('preview')).toHaveTextContent('|true')
  })

  it('does not extend into the next sentence', () => {
    press(9)
    hold()
    moveTo(13)
    expect(screen.getByTestId('range')).toHaveTextContent('9-11')
    expect(screen.getByTestId('preview')).toHaveTextContent('|true')
    release(13)
    expect(onSelect).toHaveBeenCalledWith({ from: 9, to: 11 }, sentences[0])
  })

  it('lets a scroll that starts on a word pass through untouched', () => {
    press(1)
    expect(moveTo(1, 30)).toBe(true) // not prevented: the page scrolls
    hold()
    release(1)
    expect(onActivate).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onWordTap).not.toHaveBeenCalled()
  })

  it('drops the selection on touchcancel', () => {
    press(1)
    hold()
    moveTo(3)
    fireEvent.touchCancel(word(3), { touches: [], changedTouches: [point(3)] })
    release(3)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onWordTap).not.toHaveBeenCalled()
    expect(screen.getByTestId('range')).toHaveTextContent('')
  })

  it('blocks the native context menu on words', () => {
    expect(fireEvent.contextMenu(word(1))).toBe(false)
  })

  // A native scroll already under way makes later touchmoves non-cancelable
  // (Chrome's slop is below our 10px tolerance): selection must give up.
  it('gives up when the page is already scrolling at activation', () => {
    press(1)
    hold()
    fireEvent.touchMove(word(0), {
      touches: [point(3)],
      changedTouches: [point(3)],
      cancelable: false,
    })
    expect(screen.getByTestId('range')).toHaveTextContent('')
    release(3)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onWordTap).not.toHaveBeenCalled()
  })

  it('cancels a pending hold when the page scrolls', () => {
    press(1)
    fireEvent.scroll(window)
    hold()
    release(1)
    expect(onActivate).not.toHaveBeenCalled()
    expect(onWordTap).not.toHaveBeenCalled()
  })
})

// The reader renders the text container only after the results screen is
// dismissed, so listeners must follow the element, not the first render.
describe('useTouchPhraseSelection with a late container', () => {
  function LateHarness() {
    const [shown, setShown] = useState(false)
    const [el, setEl] = useState<HTMLDivElement | null>(null)
    useTouchPhraseSelection({
      enabled: true,
      sentences,
      container: el,
      onSelect,
      onWordTap,
      onActivate,
    })
    return shown ? (
      <div ref={setEl}>
        <span data-ordinal={0}>W0</span> <span data-ordinal={1}>W1</span>
      </div>
    ) : (
      <button onClick={() => setShown(true)}>show</button>
    )
  }

  it('attaches once the container appears', () => {
    cleanup()
    render(<LateHarness />)
    fireEvent.click(screen.getByText('show'))
    press(0)
    hold()
    moveTo(1)
    release(1)
    expect(onSelect).toHaveBeenCalledWith({ from: 0, to: 1 }, sentences[0])
  })
})
