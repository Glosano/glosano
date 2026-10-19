import { create } from 'zustand'

/**
 * Vocabulary import jobs watched at app level (FLQ-14), so a running import keeps being polled
 * and refreshes the vocabulary views when it ends, even after its dialog and page are gone.
 */
interface ImportJobsState {
  /** Jobs the app-level watcher polls until they end. */
  watched: string[]
  /** Jobs whose end has already refreshed the vocabulary views. */
  settled: string[]
  /** Start watching a job; a job already watched or settled is left as is. */
  watch: (jobId: string) => void
  /** Stop watching an ended job; true only for the first call, so its refresh runs once. */
  settle: (jobId: string) => boolean
  reset: () => void
}

export const useImportJobsStore = create<ImportJobsState>((set, get) => ({
  watched: [],
  settled: [],
  watch: (jobId) => {
    const { watched, settled } = get()
    if (watched.includes(jobId) || settled.includes(jobId)) return
    set({ watched: [...watched, jobId] })
  },
  settle: (jobId) => {
    const { watched, settled } = get()
    if (!watched.includes(jobId)) return false
    set({ watched: watched.filter((id) => id !== jobId), settled: [...settled, jobId] })
    return true
  },
  reset: () => set({ watched: [], settled: [] }),
}))
