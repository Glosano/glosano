import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'
import { useImportJobsStore } from '@/stores/importJobsStore'
import { usePolledImportJob } from './useImportJob'

/**
 * Always mounted at the app root: polls every watched import job and refreshes the vocabulary
 * views once when a job ends, wherever the user is by then (FLQ-14).
 */
export function ImportJobsWatcher() {
  const watched = useImportJobsStore((state) => state.watched)
  return (
    <>
      {watched.map((jobId) => (
        <WatchedImportJob key={jobId} jobId={jobId} />
      ))}
    </>
  )
}

function WatchedImportJob({ jobId }: { jobId: string }) {
  const qc = useQueryClient()
  const settle = useImportJobsStore((state) => state.settle)
  const { data } = usePolledImportJob(jobId)
  const ended = data !== undefined && data.status !== 'running'
  useEffect(() => {
    if (ended && settle(jobId)) void invalidateVocabularyViews(qc)
  }, [ended, jobId, qc, settle])
  return null
}
