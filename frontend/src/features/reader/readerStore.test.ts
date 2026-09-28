import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useReaderStore } from './readerStore'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  useReaderStore.setState({ videoAdvance: 'stop', videoPinned: true })
})

it('pins the video by default and persists the choice', () => {
  useReaderStore.setState({ videoPinned: true })
  expect(useReaderStore.getState().videoPinned).toBe(true)
  useReaderStore.getState().setVideoPinned(false)
  const saved = JSON.parse(localStorage.getItem('glosano-reader-prefs') ?? '{}')
  expect(saved.state.videoPinned).toBe(false)
})

it('keeps the video pinned for preferences saved before the option existed', async () => {
  useReaderStore.setState({ videoPinned: true, videoAdvance: 'stop' })
  localStorage.setItem(
    'glosano-reader-prefs',
    JSON.stringify({ state: { videoAdvance: 'play' }, version: 0 }),
  )
  await useReaderStore.persist.rehydrate()
  expect(useReaderStore.getState().videoAdvance).toBe('play')
  expect(useReaderStore.getState().videoPinned).toBe(true)
})

it('defaults videoPinned to true when a fresh store loads older saved preferences', async () => {
  vi.resetModules()
  localStorage.setItem(
    'glosano-reader-prefs',
    JSON.stringify({ state: { videoAdvance: 'play' }, version: 0 }),
  )
  const { useReaderStore: fresh } = await import('./readerStore')
  await fresh.persist.rehydrate()
  expect(fresh.getState().videoAdvance).toBe('play')
  expect(fresh.getState().videoPinned).toBe(true)
})
