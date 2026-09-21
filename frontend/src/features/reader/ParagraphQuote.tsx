import type { ReactNode } from 'react'
import { Check, LoaderCircle, Plus } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export type ParagraphQuoteState = 'ready' | 'pending' | 'added'
export interface ParagraphQuoteAction {
  state?: ParagraphQuoteState
  disabled?: boolean
  error?: string
}

/** A physical-left gutter; its absolute rail follows only the text block's height. */
export function ParagraphQuote({
  children,
  action,
  onQuote,
}: {
  children: ReactNode
  action?: ParagraphQuoteAction
  onQuote?: () => void
}) {
  const t = useTranslation()
  const state = action?.state ?? 'ready'
  return (
    <div>
      <div className="group/quote relative" data-paragraph-quote>
        {children}
        {onQuote && (
          <button
            type="button"
            aria-label={t(
              state === 'added'
                ? 'Абзац добавлен в чат'
                : state === 'pending'
                  ? 'Добавляем абзац…'
                  : 'Добавить абзац в чат',
            )}
            aria-pressed={state === 'added'}
            aria-busy={state === 'pending'}
            disabled={action?.disabled || state !== 'ready'}
            title={t(
              action?.disabled && state === 'ready'
                ? 'Дождитесь добавления предыдущей цитаты'
                : 'Добавить абзац в чат',
            )}
            className="absolute -left-8 top-0 bottom-0 grid w-7 place-items-center rounded border bg-muted/60 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary group-hover/quote:opacity-100 group-focus-within/quote:opacity-100 disabled:cursor-default [@media(hover:none)]:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onQuote()
            }}
          >
            {state === 'pending' ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : state === 'added' ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Plus aria-hidden className="size-4" />
            )}
          </button>
        )}
      </div>
      {action?.error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {t(action.error)}
        </p>
      )}
    </div>
  )
}
