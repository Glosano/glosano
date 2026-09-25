import { useEffect, useRef, useState } from 'react'
import { useBulkKnown } from '../useReaderQueries'
import type { BulkKnownResult, readerApi } from '@/api/reader'
import { randomId } from '@/lib/randomId'

type Request = Parameters<typeof readerApi.bulkKnown>[0]
interface Options {
  lessonId: string
  lang: string
  sourceVersion: number
  onPage(index: number): void
  pause(): void
  onSaved(result: BulkKnownResult): void
}

export function useVideoPageTransitions(options: Options) {
  const mutation = useBulkKnown(options.lessonId, options.lang)
  const request = useRef<Request | null>(null)
  const latest = useRef(options)
  latest.current = options
  const [phase, setPhase] = useState<'idle' | 'saving' | 'failed'>('idle')
  useEffect(() => {
    request.current = null
    setPhase('idle')
    return () => {
      request.current = null
    }
  }, [options.lessonId, options.sourceVersion])

  function save(body: Request) {
    setPhase('saving')
    mutation.mutate(body, {
      onSuccess: (result) => {
        if (request.current !== body || latest.current.lessonId !== body.lesson_id) return
        request.current = null
        setPhase('idle')
        latest.current.onSaved(result)
      },
      onError: () => {
        if (request.current !== body || latest.current.lessonId !== body.lesson_id) return
        setPhase('failed')
        latest.current.pause()
      },
    })
  }
  return {
    locked: phase !== 'idle',
    saving: phase === 'saving',
    failed: phase === 'failed',
    error: mutation.error,
    advance(from: number, to: number, nextPage: number): boolean {
      if (request.current) return false
      const body = {
        lesson_id: options.lessonId,
        source_version: options.sourceVersion,
        from_ordinal: from,
        to_ordinal: to,
        request_id: randomId(),
      }
      request.current = body
      options.onPage(nextPage)
      save(body)
      return true
    },
    retry() {
      if (phase === 'failed' && request.current) save(request.current)
    },
  }
}
