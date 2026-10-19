import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, RotateCw, Square } from 'lucide-react'
import { ApiError } from '@/api/client'
import type { Capabilities } from '@/api/chats'
import { Button } from '@/components/ui/button'
import { useTranslation, msg } from '@/lib/i18n'
import { COARSE_POINTER_QUERY, useMediaQuery } from '@/lib/useMediaQuery'
import { chatDrafts, useChatStore } from './chatStore'
import { useDraft } from './useChat'
import { questionOutsideQuotes } from './inlineQuotes'
import { CHAT_COLUMN_CLASS } from './chatColumn'

/** About six lines of `leading-6` text; beyond that the field scrolls. */
const MAX_INPUT_HEIGHT = 144
/** Share of the context budget after which the limit is shown. */
const CONTEXT_WARNING_SHARE = 0.8

export function ChatComposer({
  id,
  lang,
  aiEnabled,
  busy,
  capabilities,
  onStop,
  stopping = false,
}: {
  id: string | null
  lang: string
  aiEnabled: boolean
  busy: boolean
  capabilities?: Capabilities
  /** While a reply is generating, the send button becomes a stop button. */
  onStop?: () => void
  stopping?: boolean
}) {
  const t = useTranslation(),
    entry = useDraft(id),
    uid = useChatStore((s) => s.userId),
    preparation = useChatStore((s) => s.preparations[id ?? 'new']),
    insertionVersion = useChatStore((s) => s.insertionVersion),
    client = useQueryClient()
  const input = useRef<HTMLTextAreaElement>(null)
  // On-screen keyboards put Enter where users expect a line break, so touch
  // screens send only from the button (FLQ-32.7).
  const touch = useMediaQuery(COARSE_POINTER_QUERY)
  useEffect(() => {
    if (entry.loaded) input.current?.focus()
  }, [id, entry.loaded])
  const content = entry.draft
  useEffect(() => {
    const node = input.current
    if (node) {
      node.style.height = 'auto'
      node.style.height = `${Math.min(node.scrollHeight, MAX_INPUT_HEIGHT)}px`
    }
  }, [content.text])
  useEffect(() => {
    if (
      insertionVersion &&
      useChatStore.getState().insertionDraftId === id &&
      useChatStore.getState().activeId === id
    ) {
      input.current?.focus()
      input.current?.setSelectionRange(content.text.length, content.text.length)
    }
    // Only an insertion moves the caret; ordinary typing keeps its selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertionVersion, id])
  const empty = !questionOutsideQuotes(content.text)
  async function send() {
    try {
      await chatDrafts.send(id, lang)
      if (useChatStore.getState().userId === uid)
        await client.invalidateQueries({ queryKey: ['chats', uid] })
    } catch {
      /* Entry exposes error and recovery. */
    }
  }
  const blocked =
    !!preparation ||
    !entry.loaded ||
    entry.sending ||
    !!entry.conflict ||
    (!entry.pending && !!content.citation_ids.length) ||
    (!entry.pending && (!aiEnabled || busy || empty))
  const errorKey = entry.error instanceof ApiError ? entry.error.detail : ''
  const showStop = busy && !!onStop && !entry.pending
  const contextBudget = capabilities?.context_char_budget
  const nearContextLimit =
    contextBudget !== undefined && content.text.length > contextBudget * CONTEXT_WARNING_SHARE
  const draftStatus = entry.sending
    ? msg('Sending…')
    : entry.error || entry.conversionError
      ? msg('Not saved to server')
      : null
  return (
    <form
      data-chat-column
      className={`${CHAT_COLUMN_CLASS} shrink-0 space-y-2 bg-background pt-2 pb-3`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) void send()
      }}
    >
      {preparation && (
        <div role="status" className="flex items-center gap-2 text-sm">
          {t('Loading…')}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => chatDrafts.cancelCitation(id, preparation.token)}
          >
            {t('Cancel adding quote')}
          </Button>
        </div>
      )}
      {entry.conflict && (
        <div role="alert" className="space-y-2 rounded border border-amber-500 p-2 text-sm">
          <p>{t('The draft changed in another window. Your copy is saved locally.')}</p>
          <details>
            <summary>{t('Server version')}</summary>
            <p className="whitespace-pre-wrap">{entry.conflict.text}</p>
            <p>{t('Citations: {{count}}', { count: entry.conflict.citation_ids.length })}</p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => chatDrafts.resolve(id, 'server')}
            >
              {t('Load server version')}
            </Button>
            <Button type="button" variant="outline" onClick={() => chatDrafts.resolve(id, 'local')}>
              {t('Save my version')}
            </Button>
          </div>
        </div>
      )}
      <div
        data-chat-input
        className="flex items-end gap-2 rounded-3xl border bg-background py-1.5 pr-1.5 pl-4 shadow-sm focus-within:border-primary/60"
      >
        <textarea
          ref={input}
          rows={1}
          className="max-h-36 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-6 outline-none"
          aria-label={t('Message')}
          placeholder={t('Message…')}
          disabled={!entry.loaded && !entry.conversionError && !entry.error}
          maxLength={capabilities?.draft_text_char_limit ?? 16000}
          value={content.text}
          onChange={(e) => chatDrafts.edit(id, { text: e.target.value })}
          onKeyDown={(e) => {
            if (touch) return
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (!blocked) void send()
            }
          }}
        />
        {/* Room to the left of this button is reserved for a future microphone. */}
        {showStop ? (
          <Button
            type="button"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label={t('Stop response')}
            title={t('Stop response')}
            disabled={stopping}
            onClick={onStop}
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label={t(entry.pending ? msg('Retry sending') : msg('Send'))}
            title={t(entry.pending ? msg('Retry sending') : msg('Send'))}
            disabled={blocked}
          >
            {entry.pending ? (
              <RotateCw className="size-4" aria-hidden="true" />
            ) : (
              <ArrowUp className="size-4" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {!aiEnabled && (
        <p className="text-sm text-muted-foreground">
          {t('AI is disabled. History and drafts remain available; new replies are unavailable.')}
        </p>
      )}
      {/* Routine autosave states stay silent; only sending and failures surface. */}
      <div aria-live="polite" className="px-4 text-xs text-muted-foreground empty:hidden">
        {draftStatus && t(draftStatus)}
      </div>
      {!!entry.conversionError && !entry.conflict && !entry.pending && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            {t(
              'Old quotes could not be added to the message. Retry or remove the old quotes; your question text will be kept.',
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={entry.convertingCitations}
              onClick={() => void chatDrafts.load(id).catch(() => {})}
            >
              {t('Retry adding quotes')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={entry.convertingCitations}
              onClick={() => chatDrafts.removeLegacyCitations(id)}
            >
              {t('Remove old quotes')}
            </Button>
          </div>
        </div>
      )}
      {!!entry.error && !entry.conversionError && !entry.conflict && (
        <div role="alert" className="text-sm">
          <p>
            {t(
              errorKey === 'source_changed' || errorKey === 'source_unavailable'
                ? msg(
                    'The source changed or is unavailable. Remove the citation and attach it again.',
                  )
                : errorKey === 'inline_quote_too_large'
                  ? msg('The quote does not fit in the message. Shorten the text and try again.')
                  : errorKey === 'citation_too_large' ||
                      errorKey === 'attachment_count_limit' ||
                      errorKey === 'attachment_size_limit' ||
                      errorKey === 'context_limit'
                    ? msg('The context is too large. Shorten the message or remove citations.')
                    : msg('The request failed. Please try again.'),
            )}
          </p>
          {!entry.pending && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                void (entry.loaded ? chatDrafts.flush(id) : chatDrafts.load(id)).catch(() => {})
              }
            >
              {t('Retry saving')}
            </button>
          )}
        </div>
      )}
      {nearContextLimit && (
        <p className="px-4 text-xs text-muted-foreground">
          {t('Context limit: {{budget}} characters.', { budget: contextBudget })}
        </p>
      )}
    </form>
  )
}
