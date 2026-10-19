import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/vocabularyImport', () => ({
  vocabularyImportApi: { startCsv: vi.fn(), startLingq: vi.fn(), get: vi.fn(), active: vi.fn() },
}))
vi.mock('@/lib/invalidateVocabularyViews', () => ({
  invalidateVocabularyViews: vi.fn(() => Promise.resolve()),
}))

import { vocabularyImportApi, type ImportJob } from '@/api/vocabularyImport'
import { setUiLanguage } from '@/lib/i18n'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'
import { useImportJobsStore } from '@/stores/importJobsStore'
import { ImportJobsWatcher } from './ImportJobsWatcher'
import { LingqImportDialog } from './LingqImportDialog'

const api = vi.mocked(vocabularyImportApi)

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-w',
    status: 'running',
    source: 'lingq',
    language_code: 'pt',
    total: 4,
    processed: 0,
    created_tokens: 0,
    created_phrases: 0,
    updated_items: 0,
    known_words: 0,
    skipped: 0,
    issues: [],
    issues_dropped: 0,
    error_code: null,
    ...overrides,
  }
}

let client: QueryClient
beforeEach(() => {
  setUiLanguage('en')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
  useImportJobsStore.getState().reset()
  api.active.mockResolvedValue(null)
  // The radix checkbox measures itself; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
  act(() => setUiLanguage('ru'))
})

function App({ page }: { page: boolean }) {
  return (
    <QueryClientProvider client={client}>
      {page && <LingqImportDialog lang="pt" open onOpenChange={vi.fn()} />}
      <ImportJobsWatcher />
    </QueryClientProvider>
  )
}

describe('ImportJobsWatcher', () => {
  it('keeps polling and refreshes the vocabulary after the dialog unmounts', async () => {
    api.startLingq.mockResolvedValue(job())
    api.get.mockResolvedValue(job({ processed: 1 }))
    const { rerender } = render(<App page />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('LingQ API key'), 'k')
    await user.click(screen.getByRole('button', { name: 'Start import' }))
    expect(await screen.findByText('Importing… 1 of 4', {}, { timeout: 3000 })).toBeInTheDocument()

    rerender(<App page={false} />) // the user leaves the vocabulary page
    const calls = api.get.mock.calls.length
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(calls), {
      timeout: 3000,
    })
    expect(invalidateVocabularyViews).not.toHaveBeenCalled()

    api.get.mockResolvedValue(job({ status: 'done', processed: 4, created_tokens: 4 }))
    await waitFor(() => expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    })
    expect(useImportJobsStore.getState().watched).toEqual([])

    // Polling has stopped and the refresh is not repeated.
    const finalCalls = api.get.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(api.get).toHaveBeenCalledTimes(finalCalls)
    expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1)
  })

  it('refreshes once per job even if the same job is watched again', async () => {
    api.get.mockResolvedValue(job({ status: 'done' }))
    render(<App page={false} />)

    act(() => useImportJobsStore.getState().watch('job-w'))
    await waitFor(() => expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1))
    act(() => useImportJobsStore.getState().watch('job-w'))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1)
    expect(useImportJobsStore.getState().watched).toEqual([])
  })
})
