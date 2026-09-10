import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/reader', () => ({
  readerApi: {
    putPosition: vi.fn(),
    bulkKnown: vi.fn(),
    undoBulk: vi.fn(),
    vocabulary: vi.fn(),
  },
}))
vi.mock('@/api/lessons', () => ({ lessonsApi: {} }))
vi.mock('@/api/vocabulary', () => ({ vocabularyApi: {} }))

import { readerApi } from '@/api/reader'

import { useBulkKnown, useLessonVocabulary, usePutPosition, useUndoBulk } from './useReaderQueries'

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

describe('useLessonVocabulary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  function wrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  const newItem = {
    kind: 'token' as const,
    item_id: null,
    text: 'casa',
    display_text: 'Casa',
    status: 'new' as const,
    confidence: null,
    primary_translation: null,
    added_here: false,
    context: null,
  }

  function snapshot(lessonId: string, items = [newItem]) {
    return { lesson_id: lessonId, language_code: 'pt', items }
  }

  it('does not request a vocabulary snapshot when disabled', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useLessonVocabulary('lesson-1', 'ru', false), {
      wrapper: wrapper(queryClient),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(readerApi.vocabulary).not.toHaveBeenCalled()
  })

  it('does not display the previous lesson snapshot while the next lesson loads', async () => {
    let resolveSecond!: (value: ReturnType<typeof snapshot>) => void
    const secondSnapshot = new Promise<ReturnType<typeof snapshot>>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(readerApi.vocabulary).mockImplementation((lessonId) =>
      lessonId === 'lesson-1' ? Promise.resolve(snapshot('lesson-1')) : secondSnapshot,
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result, rerender } = renderHook(
      ({ lessonId }) => useLessonVocabulary(lessonId, 'ru', true),
      { initialProps: { lessonId: 'lesson-1' }, wrapper: wrapper(queryClient) },
    )
    await waitFor(() => expect(result.current.data?.lesson_id).toBe('lesson-1'))

    rerender({ lessonId: 'lesson-2' })
    expect(result.current.data).toBeUndefined()

    resolveSecond(snapshot('lesson-2', []))
    await waitFor(() => expect(result.current.data?.lesson_id).toBe('lesson-2'))
  })

  it('refreshes active snapshots after bulk-known and undo but preserves them after a failed write', async () => {
    vi.mocked(readerApi.vocabulary)
      .mockResolvedValueOnce(snapshot('lesson-1'))
      .mockResolvedValueOnce(snapshot('lesson-1', []))
      .mockResolvedValueOnce(snapshot('lesson-1'))
    vi.mocked(readerApi.bulkKnown).mockResolvedValue({ action_id: 'action-1', created_count: 1 })
    vi.mocked(readerApi.undoBulk).mockResolvedValue({ undone_count: 1 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(
      () => ({
        vocabulary: useLessonVocabulary('lesson-1', 'ru', true),
        bulkKnown: useBulkKnown('lesson-1', 'pt'),
        undoBulk: useUndoBulk('lesson-1', 'pt'),
      }),
      { wrapper: wrapper(queryClient) },
    )
    await waitFor(() => expect(result.current.vocabulary.data?.items).toEqual([newItem]))

    result.current.bulkKnown.mutate({
      lesson_id: 'lesson-1',
      from_ordinal: 0,
      to_ordinal: 9,
    })
    await waitFor(() => expect(result.current.vocabulary.data?.items).toEqual([]))

    result.current.undoBulk.mutate('action-1')
    await waitFor(() => expect(result.current.vocabulary.data?.items).toEqual([newItem]))

    vi.mocked(readerApi.bulkKnown).mockRejectedValueOnce(new Error('network error'))
    result.current.bulkKnown.mutate({
      lesson_id: 'lesson-1',
      from_ordinal: 0,
      to_ordinal: 9,
    })
    await waitFor(() => expect(result.current.bulkKnown.isError).toBe(true))
    expect(result.current.vocabulary.data?.items).toEqual([newItem])
    expect(readerApi.vocabulary).toHaveBeenCalledTimes(3)
  })
})
