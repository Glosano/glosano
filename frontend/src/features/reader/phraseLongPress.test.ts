import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLongPress, LONG_PRESS_MS } from './phraseLongPress'

describe('createLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('activates once after the hold time and not before', () => {
    const onActivate = vi.fn()
    const press = createLongPress(onActivate)
    press.start(100, 100, 1)
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onActivate).not.toHaveBeenCalled()
    expect(press.phase).toBe('pending')
    vi.advanceTimersByTime(1)
    expect(onActivate).toHaveBeenCalledOnce()
    expect(press.phase).toBe('selecting')
  })

  it('keeps waiting on a small wobble but cancels on a real move before activation', () => {
    const onActivate = vi.fn()
    const press = createLongPress(onActivate)
    press.start(100, 100, 1)
    expect(press.move(105, 104, 1)).toBe('none')
    expect(press.phase).toBe('pending')
    expect(press.move(100, 112, 1)).toBe('none')
    expect(press.phase).toBe('idle')
    vi.runAllTimers()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('never activates for a multi-touch start and cancels when a second finger lands', () => {
    const onActivate = vi.fn()
    const press = createLongPress(onActivate)
    press.start(100, 100, 2)
    vi.runAllTimers()
    expect(onActivate).not.toHaveBeenCalled()

    press.start(100, 100, 1)
    press.move(101, 100, 2)
    vi.runAllTimers()
    expect(onActivate).not.toHaveBeenCalled()

    press.start(100, 100, 1)
    vi.runAllTimers()
    expect(press.move(150, 100, 2)).toBe('none')
    expect(press.phase).toBe('idle')
  })

  it('reports selecting moves and a selected release after activation', () => {
    const press = createLongPress(vi.fn())
    press.start(100, 100, 1)
    vi.runAllTimers()
    expect(press.move(180, 140, 1)).toBe('select')
    expect(press.end()).toBe('selected')
    expect(press.phase).toBe('idle')
  })

  it('treats a release before activation as a plain tap and clears the timer', () => {
    const onActivate = vi.fn()
    const press = createLongPress(onActivate)
    press.start(100, 100, 1)
    vi.advanceTimersByTime(100)
    expect(press.end()).toBe('none')
    vi.runAllTimers()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('cancel clears a pending or active gesture', () => {
    const onActivate = vi.fn()
    const press = createLongPress(onActivate)
    press.start(100, 100, 1)
    press.cancel()
    vi.runAllTimers()
    expect(onActivate).not.toHaveBeenCalled()
    press.start(100, 100, 1)
    vi.runAllTimers()
    press.cancel()
    expect(press.end()).toBe('none')
  })
})
