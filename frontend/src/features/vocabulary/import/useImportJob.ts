import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { vocabularyImportApi, type ImportJob } from '@/api/vocabularyImport'

const POLL_MS = 1000
const RETRY_MS = 500

export const importJobKey = (jobId: string | null) => ['vocabulary-import', jobId] as const

function importJobQuery(jobId: string | null) {
  return {
    queryKey: importJobKey(jobId),
    queryFn: () => vocabularyImportApi.get(jobId!),
    enabled: jobId !== null,
    // A few retries per fetch; once a fetch still fails the query is in error.
    retry: 2,
    retryDelay: RETRY_MS,
  }
}

/** Puts a job the server just returned into the cache the progress view reads. */
export function rememberImportJob(qc: QueryClient, job: ImportJob): void {
  qc.setQueryData(importJobKey(job.id), job)
}

/**
 * Polls a job every second while it runs; polling stops once it ends or a fetch keeps failing.
 * Used by the app-level watcher only, so one job is polled once however many views show it.
 */
export function usePolledImportJob(jobId: string) {
  return useQuery({
    ...importJobQuery(jobId),
    refetchInterval: (q) =>
      q.state.status !== 'error' && q.state.data?.status === 'running' ? POLL_MS : false,
  })
}

/** Reads a job from the cache the watcher keeps fresh; `refetch` checks it again on demand. */
export function useImportJob(jobId: string | null) {
  return useQuery(importJobQuery(jobId))
}

/** The running (or just finished) import of the language, looked up when the dialog opens. */
export function useActiveImport(lang: string, enabled: boolean) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['vocabulary-import-active', lang],
    queryFn: async () => {
      const job = await vocabularyImportApi.active(lang)
      if (job) rememberImportJob(qc, job)
      return job
    },
    enabled,
    staleTime: 0,
  })
}
