import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/reader', () => ({
  readerApi: {
    putPosition: vi.fn(),
    bulkKnown: vi.fn(),
    undoBulk: vi.fn(),
  },
}))
vi.mock('@/api/lessons', () => ({ lessonsApi: {} }))
vi.mock('@/api/vocabulary', () => ({ vocabularyApi: {} }))

import { readerApi } from '@/api/reader'

import { useBulkKnown, usePutPosition, useUndoBulk } from './useReaderQueries'

/**
 * Nothing else in the app invalidates ['lessons', lang] after a reader write
 * (FLQ-8a follow-up, finding 2) — the library card's read-percent and
 * new-words count would otherwise sit stale for the query's 30s staleTime
 * after the user leaves the reader. These tests pin that each mutation that
 * changes those numbers invalidates the library list query on success, and
 * only on success (not eagerly, so the refresh is ordered after the write it
 * depends on has actually landed).
 */
describe('useReaderQueries: library list invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function wrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  it('usePutPosition invalidates the library list for the lesson language on success', async () => {
    vi.mocked(readerApi.putPosition).mockResolvedValue(undefined)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => usePutPosition('pt'), { wrapper: wrapper(queryClient) })
    result.current.mutate({
      lesson_id: 'lesson-1',
      view_mode: 'page',
      current_segment_id: null,
      current_token_ordinal: 5,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lessons', 'pt'] })
  })

  it('usePutPosition does not invalidate the library list when the mutation fails', async () => {
    vi.mocked(readerApi.putPosition).mockRejectedValue(new Error('network error'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => usePutPosition('pt'), { wrapper: wrapper(queryClient) })
    result.current.mutate({
      lesson_id: 'lesson-1',
      view_mode: 'page',
      current_segment_id: null,
      current_token_ordinal: 5,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['lessons', 'pt'] })
  })

  it('useBulkKnown invalidates both reader-statuses and the library list on success', async () => {
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'a1', created_count: 3 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useBulkKnown('lesson-1', 'pt'), {
      wrapper: wrapper(queryClient),
    })
    result.current.mutate({ lesson_id: 'lesson-1', from_ordinal: 0, to_ordinal: 9 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reader-statuses', 'lesson-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lessons', 'pt'] })
  })

  it('useUndoBulk invalidates both reader-statuses and the library list on success', async () => {
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 3 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUndoBulk('lesson-1', 'pt'), {
      wrapper: wrapper(queryClient),
    })
    result.current.mutate('a1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reader-statuses', 'lesson-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lessons', 'pt'] })
  })
})
