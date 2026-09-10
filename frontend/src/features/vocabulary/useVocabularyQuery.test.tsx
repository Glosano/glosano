import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: {
    bulk: vi.fn(),
    patchItem: vi.fn(),
  },
}))

import { vocabularyApi } from '@/api/vocabulary'

import { useBulkAction, usePatchItem } from './useVocabularyQuery'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('vocabulary writes', () => {
  it('invalidates lesson vocabulary snapshots after a successful bulk action', async () => {
    vi.mocked(vocabularyApi.bulk).mockResolvedValue({ affected: 1 })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['reader-vocabulary', 'lesson-1', 'ru'], { items: [] })
    const { result } = renderHook(useBulkAction, { wrapper: wrapper(qc) })

    result.current.mutate({ item_ids: ['token-1'], action: 'set_known' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(qc.getQueryState(['reader-vocabulary', 'lesson-1', 'ru'])?.isInvalidated).toBe(true)
  })

  it('invalidates lesson vocabulary snapshots after a successful item patch', async () => {
    vi.mocked(vocabularyApi.patchItem).mockResolvedValue({
      item_id: 'token-1',
      status: 'tracked',
      confidence: 2,
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['reader-vocabulary', 'lesson-1', 'ru'], { items: [] })
    const { result } = renderHook(usePatchItem, { wrapper: wrapper(qc) })

    result.current.mutate({
      itemId: 'token-1',
      kind: 'token',
      status: 'tracked',
      confidence: 2,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(qc.getQueryState(['reader-vocabulary', 'lesson-1', 'ru'])?.isInvalidated).toBe(true)
  })

  it('preserves lesson vocabulary snapshots when a bulk action fails', async () => {
    vi.mocked(vocabularyApi.bulk).mockRejectedValue(new Error('network error'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['reader-vocabulary', 'lesson-1', 'ru'], { items: [] })
    const { result } = renderHook(useBulkAction, { wrapper: wrapper(qc) })

    result.current.mutate({ item_ids: ['token-1'], action: 'set_known' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(qc.getQueryState(['reader-vocabulary', 'lesson-1', 'ru'])?.isInvalidated).toBe(false)
  })
})
