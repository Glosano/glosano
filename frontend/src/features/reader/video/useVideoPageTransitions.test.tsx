import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useVideoPageTransitions } from './useVideoPageTransitions'
import { readerApi, type BulkKnownResult } from '@/api/reader'
vi.mock('@/api/reader', async (original) => ({
  ...(await original<typeof import('@/api/reader')>()),
  readerApi: { bulkKnown: vi.fn() },
}))

it('advances once, blocks another pending boundary and retries the same page request', async () => {
  let rejectRequest: (reason: Error) => void = () => {}
  vi.mocked(readerApi.bulkKnown)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        }),
    )
    .mockResolvedValueOnce({ action_id: 'action-1', created_count: 3, undone: false })
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const changed = vi.fn()
  const pause = vi.fn()
  const saved = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () =>
      useVideoPageTransitions({
        lessonId: 'L',
        lang: 'en',
        sourceVersion: 3,
        onPage: changed,
        pause,
        onSaved: saved,
      }),
    { wrapper },
  )
  act(() => {
    expect(hook.result.current.advance(0, 249, 1)).toBe(true)
  })
  expect(changed).toHaveBeenCalledWith(1)
  act(() => {
    expect(hook.result.current.advance(250, 499, 2)).toBe(false)
  })
  await waitFor(() => expect(readerApi.bulkKnown).toHaveBeenCalledTimes(1))
  const first = vi.mocked(readerApi.bulkKnown).mock.calls[0]![0]
  await act(async () => {
    rejectRequest(new Error('Network'))
  })
  expect(hook.result.current.failed).toBe(true)
  expect(pause).toHaveBeenCalled()
  act(() => hook.result.current.retry())
  await waitFor(() => expect(hook.result.current.locked).toBe(false))
  expect(vi.mocked(readerApi.bulkKnown).mock.calls[1]![0]).toEqual(first)
  expect(saved).toHaveBeenCalledWith({ action_id: 'action-1', created_count: 3, undone: false })
  client.clear()
})

it('ignores late success after changing material', async () => {
  let resolveRequest: (value: BulkKnownResult) => void = () => {}
  vi.mocked(readerApi.bulkKnown).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
  )
  const client = new QueryClient()
  const saved = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    ({ lessonId }) =>
      useVideoPageTransitions({
        lessonId,
        lang: 'en',
        sourceVersion: 1,
        onPage: () => {},
        pause: () => {},
        onSaved: saved,
      }),
    { wrapper, initialProps: { lessonId: 'old' } },
  )
  act(() => {
    hook.result.current.advance(0, 5, 1)
  })
  await act(async () => {})
  hook.rerender({ lessonId: 'new' })
  await act(async () => {
    resolveRequest({ action_id: 'old-action', created_count: 2 })
  })
  expect(saved).not.toHaveBeenCalled()
  client.clear()
})
