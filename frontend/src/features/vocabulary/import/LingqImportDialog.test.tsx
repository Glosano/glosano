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

import { ApiError } from '@/api/client'
import { vocabularyImportApi, type ImportJob } from '@/api/vocabularyImport'
import { setUiLanguage } from '@/lib/i18n'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'
import { useImportJobsStore } from '@/stores/importJobsStore'
import { ImportJobsWatcher } from './ImportJobsWatcher'
import { LingqImportDialog } from './LingqImportDialog'

const api = vi.mocked(vocabularyImportApi)

let jobSeq = 0
function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: `job-${jobSeq}`,
    status: 'running',
    source: 'lingq',
    language_code: 'pt',
    total: null,
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
  jobSeq += 1
  setUiLanguage('en')
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
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

function setup() {
  render(
    <QueryClientProvider client={client}>
      <LingqImportDialog lang="pt" open onOpenChange={vi.fn()} />
      <ImportJobsWatcher />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function startTokenImport(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('LingQ API key'), 'k')
  await user.click(screen.getByRole('button', { name: 'Start import' }))
}

describe('LingqImportDialog', () => {
  it('link points to LingQ API key page', async () => {
    setup()
    const link = await screen.findByRole('link', {
      name: 'Sign in to LingQ and open the API key page',
    })
    expect(link).toHaveAttribute('href', 'https://www.lingq.com/en/accounts/apikey/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('token tab says that known words from reading are not transferred', async () => {
    setup()
    expect(await screen.findByRole('tab', { name: 'By token (with levels)' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.',
      ),
    ).toBeInTheDocument()
  })

  it('submits token with conflict mode and clears the field', async () => {
    api.startLingq.mockReturnValue(new Promise(() => {}))
    const user = setup()
    const input = await screen.findByLabelText('LingQ API key')
    // Not a password field, so browsers and password managers do not offer to save the key.
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('data-1p-ignore')
    expect(input).toHaveAttribute('data-lpignore', 'true')
    expect(input.closest('form')!.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Keep its level' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Import LingQ tags' })).toBeChecked()

    await user.type(input, 'k')
    await user.click(screen.getByRole('radio', { name: 'Update from LingQ' }))
    await user.click(screen.getByRole('button', { name: 'Start import' }))

    expect(api.startLingq).toHaveBeenCalledWith('pt', {
      token: 'k',
      conflictMode: 'update',
      importTags: true,
    })
    expect(screen.getByLabelText('LingQ API key')).toHaveValue('')
  })

  it('csv tab shows the no-levels warning and uploads file', async () => {
    api.startCsv.mockResolvedValue(job({ source: 'csv', total: 2 }))
    api.get.mockResolvedValue(job({ source: 'csv', total: 2 }))
    const user = setup()
    await user.click(await screen.findByRole('tab', { name: 'CSV file' }))

    expect(
      screen.getByText(
        'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.',
      ),
    ).toBeInTheDocument()
    const file = new File(['term,hint\nolá,hello\n'], 'lingqs.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Choose file'), file)
    await user.click(screen.getByRole('checkbox', { name: 'Import LingQ tags' }))
    await user.click(screen.getByRole('button', { name: 'Start import' }))

    expect(api.startCsv).toHaveBeenCalledWith('pt', file, {
      status: 'tracked',
      confidence: 1,
      importTags: false,
    })
    expect(await screen.findByText('Importing… 0 of 2')).toBeInTheDocument()
  })

  it('shows progress then report', async () => {
    api.startLingq.mockResolvedValue(job())
    api.get.mockResolvedValueOnce(job({ total: 100, processed: 50 })).mockResolvedValue(
      job({
        status: 'done',
        total: 100,
        processed: 100,
        created_tokens: 3,
        created_phrases: 1,
        updated_items: 2,
        known_words: 7,
        skipped: 1,
        issues: [{ row: 4, term: 'xyz', code: 'translation_too_long' }],
      }),
    )
    const user = setup()
    await user.type(await screen.findByLabelText('LingQ API key'), 'k')
    await user.click(screen.getByRole('button', { name: 'Start import' }))

    expect(await screen.findByText('Importing… 50 of 100')).toBeInTheDocument()
    expect(
      screen.getByText('You can close this window — the import will continue.'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Added: 3 words, 1 phrases', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Import finished')).toBeInTheDocument()
    expect(screen.getByText('Updated: 2')).toBeInTheDocument()
    expect(screen.getByText('New known words: 7')).toBeInTheDocument()
    expect(screen.getByText('Skipped: 1')).toBeInTheDocument()
    await user.click(screen.getByText('Show details'))
    expect(screen.getByText(/Translation is longer than 512 characters/)).toBeInTheDocument()
    expect(screen.getByText(/xyz/)).toBeInTheDocument()

    await waitFor(() => expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1)
  })

  it('maps lingq_unauthorized to message', async () => {
    api.startLingq.mockResolvedValue(job())
    api.get.mockResolvedValue(job({ status: 'failed', error_code: 'lingq_unauthorized' }))
    const user = setup()
    await user.type(await screen.findByLabelText('LingQ API key'), 'k')
    await user.click(screen.getByRole('button', { name: 'Start import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'LingQ rejected the key. Check it and try again.',
    )
  })

  it('maps a start error detail to message', async () => {
    api.startLingq.mockRejectedValue(new ApiError(409, 'import_already_running'))
    const user = setup()
    await user.type(await screen.findByLabelText('LingQ API key'), 'k')
    await user.click(screen.getByRole('button', { name: 'Start import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('An import is already running.')
  })

  it('shows the interrupted message for any interrupted job', async () => {
    api.active.mockResolvedValue(job({ status: 'interrupted', error_code: 'server_stopped' }))
    api.get.mockResolvedValue(job({ status: 'interrupted', error_code: 'server_stopped' }))
    setup()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The import was interrupted. Start it again — nothing will be duplicated.',
    )
  })

  it('shows running import on reopen', async () => {
    api.active.mockResolvedValue(job({ total: 10, processed: 4 }))
    api.get.mockResolvedValue(job({ total: 10, processed: 4 }))
    setup()

    expect(await screen.findByText('Importing… 4 of 10')).toBeInTheDocument()
    expect(screen.queryByLabelText('LingQ API key')).not.toBeInTheDocument()
    expect(api.active).toHaveBeenCalledWith('pt')
  })

  it('shows a generic message for an unknown issue code', async () => {
    const finished = job({
      status: 'done',
      issues: [{ row: 2, term: 'abc', code: 'something_new' }],
    })
    api.active.mockResolvedValue(finished)
    api.get.mockResolvedValue(finished)
    const user = setup()

    await user.click(await screen.findByText('Show details'))
    expect(screen.getByText('Row 2 · abc — This row was skipped.')).toBeInTheDocument()
    expect(screen.queryByText(/something_new/)).not.toBeInTheDocument()
  })

  it('shows how many issues are not listed', async () => {
    const finished = job({
      status: 'done',
      issues: [{ row: 2, term: 'abc', code: 'empty_term' }],
      issues_dropped: 12,
    })
    api.active.mockResolvedValue(finished)
    api.get.mockResolvedValue(finished)
    const user = setup()

    await user.click(await screen.findByText('Show details'))
    expect(screen.getByText('and 12 more not shown')).toBeInTheDocument()
  })

  it('hides the not-listed line when no issue was dropped', async () => {
    const finished = job({ status: 'done', issues: [{ row: 2, term: 'abc', code: 'empty_term' }] })
    api.active.mockResolvedValue(finished)
    api.get.mockResolvedValue(finished)
    const user = setup()

    await user.click(await screen.findByText('Show details'))
    expect(screen.queryByText(/more not shown/)).not.toBeInTheDocument()
  })

  it('on a lost connection stops polling, keeps the job and checks again on demand', async () => {
    api.startLingq.mockResolvedValue(job())
    api.get.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = setup()
    await startTokenImport(user)

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'Lost connection to the server — the import status is unknown.',
    )
    const calls = api.get.mock.calls.length
    expect(calls).toBe(3) // the first poll and two retries
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(api.get).toHaveBeenCalledTimes(calls)
    // The job may still be running: it is not dismissed, so no new import can be started.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('LingQ API key')).not.toBeInTheDocument()

    api.get.mockResolvedValue(job({ total: 10, processed: 6 }))
    await user.click(screen.getByRole('button', { name: 'Check again' }))

    expect(await screen.findByText('Importing… 6 of 10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    // Polling resumes once the job is reachable again.
    api.get.mockResolvedValue(job({ status: 'done', total: 10, processed: 10 }))
    expect(await screen.findByText('Import finished', {}, { timeout: 3000 })).toBeInTheDocument()
    await waitFor(() => expect(invalidateVocabularyViews).toHaveBeenCalledTimes(1))
  })

  it('lets a job that is gone (404) be dismissed', async () => {
    api.startLingq.mockResolvedValue(job())
    api.get.mockRejectedValue(new ApiError(404, 'import_not_found'))
    const user = setup()
    await startTokenImport(user)

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'The import was not found.',
    )
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('LingQ API key')).toBeInTheDocument()
  })
})
