import { useState } from 'react'

import { useTranslation } from '@/lib/i18n'

import { translationErrorMessage } from './translationError'
import { useSegmentTranslation } from './useReaderQueries'

interface Props {
  lessonId: string
  segId: string
  targetLang: string
}

// Точка в конце предложения постраничного ридера: по клику подгружает перевод
// сегмента и показывает его инлайн сразу после предложения.
export function InlineSentenceTranslation({ lessonId, segId, targetLang }: Props) {
  const tr = useTranslation()
  const [requested, setRequested] = useState(false)
  const [open, setOpen] = useState(false)
  const translation = useSegmentTranslation(lessonId, segId, targetLang, requested)
  const loading = open && translation.isFetching && !translation.isSuccess

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setRequested(true)
    setOpen(true)
    if (translation.isError) void translation.refetch()
  }

  return (
    <>
      {' '}
      <button
        type="button"
        data-testid="sentence-translation-toggle"
        aria-expanded={open}
        aria-busy={loading || undefined}
        aria-label={open ? tr('Скрыть перевод предложения') : tr('Показать перевод предложения')}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className="group relative inline-flex size-[1.1em] items-center justify-center rounded-full align-[-0.15em] select-none after:absolute after:-inset-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--reader-translation-fg)]"
      >
        {loading ? (
          <span
            aria-hidden
            className="size-[0.8em] animate-spin rounded-full border-2 border-[var(--reader-translation-dot)] border-t-transparent"
          />
        ) : (
          <span
            aria-hidden
            className="size-[0.7em] rounded-full bg-[var(--reader-translation-dot)] transition-colors group-hover:bg-[var(--reader-translation-fg)]"
          />
        )}
      </button>
      {open && !loading && (translation.isSuccess || translation.isError) && (
        <span
          data-testid="sentence-translation"
          dir="auto"
          className="ms-1.5 border-x-2 border-[var(--reader-translation-dot)] px-2 italic text-[var(--reader-translation-fg)]"
        >
          {translation.isSuccess ? (
            <>
              {translation.data.text}
              {translation.data.source === 'ai' && (
                <span className="ms-2 inline-block rounded-full bg-muted px-1.5 align-middle text-[0.7em] font-medium leading-normal text-muted-foreground not-italic">
                  AI
                </span>
              )}
            </>
          ) : (
            <span className="text-destructive">{translationErrorMessage(translation.error)}</span>
          )}
        </span>
      )}
    </>
  )
}
