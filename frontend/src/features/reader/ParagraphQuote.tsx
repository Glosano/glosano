import type { ReactNode } from 'react'
import { Check, LoaderCircle, Plus } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export type ParagraphQuoteState = 'ready' | 'pending' | 'added'
export interface ParagraphQuoteAction {
  state?: ParagraphQuoteState
  disabled?: boolean
  error?: string
}

/**
 * A physical-left gutter rail: a plus centred on the text block's height and a
 * thin grey line just left of the text. The rail spans the whole gap to the
 * text, so moving the pointer from the paragraph to the plus never leaves the
 * hover group and the control does not flicker.
 */
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
          <div className="absolute -left-11 top-0 bottom-0 w-11 opacity-0 transition-opacity group-hover/quote:opacity-100 group-focus-within/quote:opacity-100 [@media(hover:none)]:opacity-100">
            <span
              aria-hidden
              className="absolute right-2 top-0 bottom-0 w-0.5 rounded-full bg-muted-foreground/30"
            />
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
              className="absolute left-0 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default"
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
          </div>
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
