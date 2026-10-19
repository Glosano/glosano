import { api } from './client'

export type ImportJobStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface ImportIssue {
  row: number | null
  term: string | null
  code: string
}

export interface ImportJob {
  id: string
  status: ImportJobStatus
  source: 'csv' | 'lingq'
  language_code: string
  total: number | null
  processed: number
  created_tokens: number
  created_phrases: number
  updated_items: number
  known_words: number
  skipped: number
  issues: ImportIssue[]
  /** Issues past the server's report cap: counted, not listed. */
  issues_dropped: number
  error_code: string | null
}

const BASE = '/api/vocabulary/import'

export const vocabularyImportApi = {
  startCsv: (
    lang: string,
    file: File,
    opts: { status: 'tracked' | 'known'; confidence: number | null; importTags: boolean },
  ) => {
    const body = new FormData()
    body.set('file', file)
    body.set('lang', lang)
    body.set('status', opts.status)
    if (opts.status === 'tracked' && opts.confidence !== null) {
      body.set('confidence', String(opts.confidence))
    }
    body.set('import_tags', String(opts.importTags))
    return api<ImportJob>(`${BASE}/csv`, { method: 'POST', body })
  },
  // The token travels only in the request body: never in a URL, query key or storage.
  startLingq: (
    lang: string,
    body: { token: string; conflictMode: 'keep' | 'update'; importTags: boolean },
  ) =>
    api<ImportJob>(`${BASE}/lingq`, {
      method: 'POST',
      body: JSON.stringify({
        lang,
        token: body.token,
        conflict_mode: body.conflictMode,
        import_tags: body.importTags,
      }),
    }),
  get: (jobId: string) => api<ImportJob>(`${BASE}/${encodeURIComponent(jobId)}`),
  active: (lang: string) =>
    api<ImportJob | null>(`${BASE}/active?${new URLSearchParams({ lang }).toString()}`),
}
