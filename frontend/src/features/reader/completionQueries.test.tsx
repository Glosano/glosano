import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { readerApi, type CompleteLessonResult } from '@/api/reader'
import { lessonsApi, type LessonDetail } from '@/api/lessons'
import { useCompleteLesson, useUndoBulk } from './useReaderQueries'

function setup(completed = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const lesson = (id: string): LessonDetail => ({
    id,
    title: id,
    language_code: 'en',
    word_count: 1,
    visibility: 'private',
    status: 'ready',
    created_at: '',
    segment_count: 1,
    read_percent: 0,
    new_words_remaining: 1,
    reader_position: {
      view_mode: 'page',
      current_segment_id: id,
      current_token_ordinal: 0,
      completed_at: completed ? '2026-09-13T00:00:00Z' : null,
      completion_action_id: completed ? `action-${id}` : null,
    },
  })
  client.setQueryData(['lesson', 'a'], lesson('a'))
  client.setQueryData(['lesson', 'b'], lesson('b'))
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}
const body = {
  lesson_id: 'a',
  source_version: 1,
  view_mode: 'page' as const,
  last_segment_id: 'a',
  from_ordinal: 0,
  to_ordinal: 0,
}
const completion = { action_id: 'action-a', created_count: 1, completed_at: '2026-09-13T00:00:00Z' }
afterEach(() => vi.restoreAllMocks())

it('applies a late completion to its requested lesson after switching lessons', async () => {
  const { client, wrapper } = setup()
  let resolve!: (value: CompleteLessonResult) => void
  vi.spyOn(readerApi, 'complete').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const { result, rerender } = renderHook(({ id }) => useCompleteLesson(id, 'en'), {
    initialProps: { id: 'a' },
    wrapper,
  })
  act(() => result.current.mutate(body))
  await waitFor(() => expect(readerApi.complete).toHaveBeenCalled())
  rerender({ id: 'b' })
  await act(async () => resolve(completion))
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData<LessonDetail>(['lesson', 'a'])?.reader_position?.completed_at).toBe(
    completion.completed_at,
  )
  expect(
    client.getQueryData<LessonDetail>(['lesson', 'b'])?.reader_position?.completed_at,
  ).toBeNull()
})

it('applies a late undo only to the lesson captured when it started', async () => {
  const { client, wrapper } = setup(true)
  let resolve!: (value: { undone_count: number }) => void
  vi.spyOn(readerApi, 'undoBulk').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const { result, rerender } = renderHook(({ id }) => useUndoBulk(id, 'en'), {
    initialProps: { id: 'a' },
    wrapper,
  })
  act(() => result.current.mutate('action-a'))
  await waitFor(() => expect(readerApi.undoBulk).toHaveBeenCalled())
  rerender({ id: 'b' })
  await act(async () => resolve({ undone_count: 1 }))
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(
    client.getQueryData<LessonDetail>(['lesson', 'a'])?.reader_position?.completed_at,
  ).toBeNull()
  expect(client.getQueryData<LessonDetail>(['lesson', 'b'])?.reader_position?.completed_at).toBe(
    completion.completed_at,
  )
})

it('reconciles an already successful undo after the response was lost', async () => {
  const { client, wrapper } = setup(true)
  vi.spyOn(readerApi, 'undoBulk').mockRejectedValue(new ApiError(409, 'already_undone'))
  const current = client.getQueryData<LessonDetail>(['lesson', 'a'])!
  vi.spyOn(lessonsApi, 'get').mockResolvedValue({ ...current, reader_position: null })
  const { result } = renderHook(() => useUndoBulk('a', 'en'), { wrapper })
  act(() => result.current.mutate('action-a'))
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(
    client.getQueryData<LessonDetail>(['lesson', 'a'])?.reader_position,
  ).toBeNull()
})

it('keeps a newer completion when an old action was undone in another tab', async () => {
  const { client, wrapper } = setup(true)
  const current = client.getQueryData<LessonDetail>(['lesson', 'a'])!
  const latest = {
    ...current,
    reader_position: { ...current.reader_position!, completion_action_id: 'new-action' },
  }
  vi.spyOn(readerApi, 'undoBulk').mockRejectedValue(new ApiError(409, 'already_undone'))
  vi.spyOn(lessonsApi, 'get').mockResolvedValue(latest)
  const { result } = renderHook(() => useUndoBulk('a', 'en'), { wrapper })
  act(() => result.current.mutate('action-a'))
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(
    client.getQueryData<LessonDetail>(['lesson', 'a'])?.reader_position?.completion_action_id,
  ).toBe('new-action')
})
