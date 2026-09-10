import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/api/reader', () => ({
  readerApi: {
    vocabulary: vi.fn(),
  },
}))
vi.mock('@/api/lessons', () => ({ lessonsApi: {} }))
vi.mock('@/api/vocabulary', () => ({
  vocabularyApi: {
    addTranslation: vi.fn(),
  },
}))

import { readerApi } from '@/api/reader'
import { vocabularyApi } from '@/api/vocabulary'

import { useLessonVocabulary } from './useReaderQueries'
import { useWordCardMutations } from './useWordCard'

const item = {
  kind: 'token' as const,
  item_id: 'token-1',
  text: 'casa',
  display_text: 'Casa',
  status: 'tracked' as const,
  confidence: 1,
  primary_translation: null,
  added_here: true,
  context: null,
}

const initialSnapshot = {
  lesson_id: 'lesson-1',
  language_code: 'pt',
  items: [item],
}

const translatedSnapshot = {
  ...initialSnapshot,
  items: [
    {
      ...item,
      primary_translation: { text: 'дом', target_language_code: 'ru' },
    },
  ],
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function useTranslationHarness() {
  return {
    vocabulary: useLessonVocabulary('lesson-1', 'ru', true),
    mutations: useWordCardMutations({
      kind: 'token',
      lang: 'pt',
      text: 'casa',
      surfaceText: 'Casa',
      target: 'ru',
      lessonId: 'lesson-1',
      segId: 'segment-1',
    }),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

it('refreshes an active lesson vocabulary after saving a translation', async () => {
  vi.mocked(readerApi.vocabulary)
    .mockResolvedValueOnce(initialSnapshot)
    .mockResolvedValueOnce(translatedSnapshot)
  vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
    id: 'translation-1',
    text: 'дом',
    target_language_code: 'ru',
    is_primary: true,
    source_type: 'user',
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const { result } = renderHook(useTranslationHarness, { wrapper: wrapper(queryClient) })
  await waitFor(() => expect(result.current.vocabulary.data).toEqual(initialSnapshot))

  result.current.mutations.saveTranslation.mutate({ itemId: 'token-1', text: 'дом' })

  await waitFor(() =>
    expect(result.current.vocabulary.data?.items[0]?.primary_translation?.text).toBe('дом'),
  )
  expect(result.current.mutations.saveTranslation.isSuccess).toBe(true)
})

it('keeps a successful save distinct from a failed vocabulary refetch', async () => {
  vi.mocked(readerApi.vocabulary)
    .mockResolvedValueOnce(initialSnapshot)
    .mockRejectedValueOnce(new Error('refetch failed'))
  vi.mocked(vocabularyApi.addTranslation).mockResolvedValue({
    id: 'translation-1',
    text: 'дом',
    target_language_code: 'ru',
    is_primary: true,
    source_type: 'user',
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const { result } = renderHook(useTranslationHarness, { wrapper: wrapper(queryClient) })
  await waitFor(() => expect(result.current.vocabulary.data).toEqual(initialSnapshot))

  result.current.mutations.saveTranslation.mutate({ itemId: 'token-1', text: 'дом' })

  await waitFor(() => expect(result.current.vocabulary.isRefetchError).toBe(true))
  expect(result.current.mutations.saveTranslation.isSuccess).toBe(true)
  expect(result.current.mutations.saveTranslation.isError).toBe(false)
  expect(result.current.vocabulary.data).toEqual(initialSnapshot)
})
