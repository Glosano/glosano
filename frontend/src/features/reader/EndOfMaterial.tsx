import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { useTranslation, msg } from '@/lib/i18n'

interface Props {
  lang: string
  lessonId: string
  completed: boolean
  showNewWordsNote: boolean
  busy: boolean
  error: boolean
  onFinish: () => void
  onBack: () => void
}

/**
 * Virtual page after the last fragment (ADR-0023). Entering it writes nothing;
 * only the explicit finish action completes the material.
 */
export function EndOfMaterial({
  lang,
  lessonId,
  completed,
  showNewWordsNote,
  busy,
  error,
  onFinish,
  onBack,
}: Props) {
  const tr = useTranslation()
  const heading = useRef<HTMLHeadingElement>(null)

  // Focus the heading, not an action: a repeated or held Enter from the "›"
  // arrow must not complete the material. Finish stays the first Tab stop.
  useEffect(() => {
    heading.current?.focus()
  }, [completed])

  return (
    <section
      data-testid="end-of-material"
      className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-4 text-center"
    >
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        {tr(completed ? msg('Material completed') : msg('You have read everything'))}
      </h2>
      {!completed && showNewWordsNote && (
        <p className="text-muted-foreground">
          {tr('New words on the last page will be marked as known')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {tr('Could not complete the material. Please try again.')}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {completed ? (
          <>
            <Button asChild>
              <Link to="/learn/$lang/library" params={{ lang }}>
                {tr('Back to library')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link
                to="/learn/$lang/review"
                params={{ lang }}
                search={{ lessonId, mode: 'cards', from: 'completion' }}
              >
                {tr('Review lesson vocabulary')}
              </Link>
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={onFinish}>
            {tr('Finish material')}
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          {tr('Back to the text')}
        </Button>
      </div>
    </section>
  )
}
