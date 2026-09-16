import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { VideoPlayer, type VideoControls } from './VideoPlayer'
import { setUiLanguage } from '@/lib/i18n'

const fake = vi.hoisted(() => ({
  time: 1,
  state: 2,
  onState: (() => {}) as (state: number) => void,
  onBlocked: () => {},
  destroyed: false,
  delay: null as Promise<void> | null,
  deferredSeek: false,
  seeks: [] as number[],
}))
vi.mock('./youtubePlayer', () => ({
  createYouTubePlayer: async (
    _host: HTMLElement,
    _id: string,
    events: {
      onState: (state: number) => void
      onAutoplayBlocked: () => void
    },
  ) => {
    if (fake.delay) await fake.delay
    fake.onState = events.onState
    fake.onBlocked = events.onAutoplayBlocked
    return {
      play: () => {
        fake.state = 1
        events.onState(1)
      },
      pause: () => {
        fake.state = 2
        events.onState(2)
      },
      seek: (time: number) => {
        fake.seeks.push(time)
        if (!fake.deferredSeek) fake.time = time
      },
      time: () => fake.time,
      rate: () => 1,
      destroy: () => {
        fake.destroyed = true
      },
    }
  },
}))
const media = {
  provider: 'youtube' as const,
  video_id: 'M7lc1UVf-VE',
  canonical_url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  title: 'Video',
  author: 'Author',
  language_code: 'en',
  is_generated: false,
}
beforeEach(() => {
  setUiLanguage('en')
  fake.time = 1
  fake.state = 2
  fake.destroyed = false
  fake.delay = null
  fake.deferredSeek = false
  fake.seeks = []
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
})
afterEach(() => {
  vi.useRealTimers()
  setUiLanguage('ru')
})

it('loads on Play, stops at the interval end and replays from its start', async () => {
  render(
    <VideoPlayer media={media} interval={{ start: 1, end: 2 }} resetKey="one" onTime={() => {}} />,
  )
  expect(screen.getByRole('button', { name: 'Play fragment' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  await screen.findByRole('button', { name: 'Pause' })
  act(() => {
    fake.time = 1.9
    vi.advanceTimersByTime(100)
  })
  act(() => {
    fake.time = 2.05
    vi.advanceTimersByTime(100)
  })
  expect(fake.state).toBe(2)
  expect(screen.getByRole('button', { name: 'Play fragment' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  expect(fake.time).toBe(1)
  expect(fake.state).toBe(1)
})

it('continues an accepted natural boundary but does not bulk a native seek', async () => {
  const boundary = vi.fn(() => ({ start: 2, end: 4 }))
  const seek = vi.fn((time: number) => (time >= 8 ? { start: 8, end: 10 } : { start: 1, end: 2 }))
  render(
    <VideoPlayer
      media={media}
      interval={{ start: 1, end: 2 }}
      resetKey="one"
      onTime={() => {}}
      onBoundary={boundary}
      onSeek={seek}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  await screen.findByRole('button', { name: 'Pause' })
  // First observed sample is not evidence of continuous playback.
  act(() => {
    fake.time = 1.8
    vi.advanceTimersByTime(100)
  })
  act(() => {
    fake.time = 1.9
    vi.advanceTimersByTime(100)
  })
  act(() => {
    fake.time = 2.02
    vi.advanceTimersByTime(100)
  })
  expect(boundary).toHaveBeenCalledTimes(1)
  expect(fake.state).toBe(1)
  act(() => {
    fake.time = 8.2
    vi.advanceTimersByTime(100)
  })
  expect(boundary).toHaveBeenCalledTimes(1)
  expect(seek).toHaveBeenCalledWith(8.2)
})

it('pauses when blocked or hidden and destroys the player on unmount', async () => {
  const controls = createRef<VideoControls>()
  const props = { media, interval: { start: 1, end: 5 }, resetKey: 'one', onTime: () => {} }
  const view = render(<VideoPlayer {...props} ref={controls} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  await screen.findByRole('button', { name: 'Pause' })
  view.rerender(<VideoPlayer {...props} ref={controls} blocked />)
  await waitFor(() => expect(fake.state).toBe(2))
  expect(screen.getByRole('button', { name: 'Play fragment' })).toBeDisabled()
  view.unmount()
  expect(fake.destroyed).toBe(true)
})

it('waits through the inter-page gap before requesting a natural transition', async () => {
  const boundary = vi.fn(() => ({ start: 3, end: 5 }))
  render(
    <VideoPlayer
      media={media}
      interval={{ start: 1, end: 2 }}
      continueUntil={3}
      resetKey="one"
      onTime={() => {}}
      onBoundary={boundary}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  await screen.findByRole('button', { name: 'Pause' })
  for (const value of [1.8, 1.9, 2.02, 2.12, 2.22])
    act(() => {
      fake.time = value
      vi.advanceTimersByTime(100)
    })
  expect(boundary).not.toHaveBeenCalled()
  expect(fake.state).toBe(1)
  for (const value of [2.32, 2.42, 2.52, 2.62, 2.72, 2.82, 2.92, 3.02])
    act(() => {
      fake.time = value
      vi.advanceTimersByTime(100)
    })
  expect(boundary).toHaveBeenCalledTimes(1)
})

it('cancels a pending Play when navigation occurs while loading the iframe', async () => {
  let ready: () => void = () => {}
  fake.delay = new Promise<void>((resolve) => {
    ready = resolve
  })
  const props = { media, interval: { start: 1, end: 2 }, onTime: () => {} }
  const view = render(<VideoPlayer {...props} resetKey="first" />)
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  view.rerender(<VideoPlayer {...props} interval={{ start: 2, end: 4 }} resetKey="next" />)
  await act(async () => {
    ready()
  })
  expect(fake.state).toBe(2)
  expect(screen.getByRole('button', { name: 'Play fragment' })).toBeEnabled()
})

it('preserves a restored fragment while a native seek is still asynchronous', async () => {
  fake.time = 0
  fake.deferredSeek = true
  render(
    <VideoPlayer
      media={media}
      interval={{ start: 10, end: 30 }}
      startTime={20}
      resetKey="one"
      onTime={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Play fragment' }))
  await screen.findByRole('button', { name: 'Pause' })
  expect(fake.seeks).toEqual([20])
  act(() => {
    vi.advanceTimersByTime(100)
  })
  expect(fake.seeks).toEqual([20])
  act(() => {
    fake.time = 20.1
    vi.advanceTimersByTime(100)
  })
  expect(fake.state).toBe(1)
})

it('starts at the last requested timestamp when initialization and seeking are delayed', async () => {
  let ready: () => void = () => {}
  fake.delay = new Promise<void>((resolve) => {
    ready = resolve
  })
  fake.time = 0
  fake.deferredSeek = true
  const controls = createRef<VideoControls>()
  render(
    <VideoPlayer
      ref={controls}
      media={media}
      interval={{ start: 10, end: 30 }}
      resetKey="one"
      onTime={() => {}}
    />,
  )
  act(() => controls.current!.playFrom(12))
  act(() => controls.current!.playFrom(20))
  await act(async () => ready())
  expect(fake.seeks).toEqual([20])
  expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  act(() => {
    fake.time = 20.1
    vi.advanceTimersByTime(100)
  })
  expect(fake.seeks).toEqual([20])
  expect(fake.state).toBe(1)
})
