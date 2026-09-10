import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useReaderHotkeys } from './useReaderHotkeys'

function HotkeyHarness({ callbacks }: { callbacks: ReturnType<typeof createCallbacks> }) {
  useReaderHotkeys({
    enabled: true,
    onPrev: callbacks.onPrev,
    onNext: callbacks.onNext,
    onToggleMode: callbacks.onToggleMode,
    onEscape: callbacks.onEscape,
    onUndo: callbacks.onUndo,
    onToggleFont: callbacks.onToggleFont,
    onToggleSidebar: callbacks.onToggleSidebar,
  })
  return (
    <>
      <div data-reader-panel>
        <button type="button">В панели</button>
      </div>
      <div data-reader-panel-popover>
        <button type="button">В поповере</button>
      </div>
      <button type="button">В ридере</button>
    </>
  )
}

function createCallbacks() {
  return {
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToggleMode: vi.fn(),
    onEscape: vi.fn(),
    onUndo: vi.fn(),
    onToggleFont: vi.fn(),
    onToggleSidebar: vi.fn(),
  }
}

describe('useReaderHotkeys', () => {
  it('ignores already prevented events so a modal layer owns one Escape', () => {
    const callbacks = createCallbacks()
    render(<HotkeyHarness callbacks={callbacks} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()

    window.dispatchEvent(event)

    expect(callbacks.onEscape).not.toHaveBeenCalled()
  })

  it.each(['В панели', 'В поповере'])(
    'does not navigate or toggle reader state from %s',
    (name) => {
      const callbacks = createCallbacks()
      render(<HotkeyHarness callbacks={callbacks} />)
      const target = screen.getByRole('button', { name })

      fireEvent.keyDown(target, { key: 'ArrowRight' })
      fireEvent.keyDown(target, { key: 'm' })
      fireEvent.keyDown(target, { key: 's' })

      expect(callbacks.onNext).not.toHaveBeenCalled()
      expect(callbacks.onToggleMode).not.toHaveBeenCalled()
      expect(callbacks.onToggleSidebar).not.toHaveBeenCalled()
    },
  )

  it('keeps reader navigation active outside the panel', () => {
    const callbacks = createCallbacks()
    render(<HotkeyHarness callbacks={callbacks} />)
    const target = screen.getByRole('button', { name: 'В ридере' })

    fireEvent.keyDown(target, { key: 'ArrowRight' })
    fireEvent.keyDown(target, { key: 'm' })

    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onToggleMode).toHaveBeenCalledTimes(1)
  })
})
