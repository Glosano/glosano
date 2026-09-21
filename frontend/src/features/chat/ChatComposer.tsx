import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import type { Capabilities } from '@/api/chats'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { chatDrafts, useChatStore } from './chatStore'
import { useDraft } from './useChat'
import { questionOutsideQuotes } from './inlineQuotes'

export function ChatComposer({
  id,
  lang,
  aiEnabled,
  busy,
  capabilities,
}: {
  id: string | null
  lang: string
  aiEnabled: boolean
  busy: boolean
  capabilities?: Capabilities
}) {
  const t = useTranslation(),
    entry = useDraft(id),
    uid = useChatStore((s) => s.userId),
    preparation = useChatStore((s) => s.preparations[id ?? 'new']),
    insertionVersion = useChatStore((s) => s.insertionVersion),
    client = useQueryClient()
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (entry.loaded) input.current?.focus()
  }, [id, entry.loaded])
  const content = entry.draft
  useEffect(() => {
    const node = input.current
    if (node) {
      node.style.height = 'auto'
      node.style.height = `${Math.min(node.scrollHeight, 320)}px`
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
  return (
    <form
      className="shrink-0 space-y-2 border-t bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) void send()
      }}
    >
      {preparation && (
        <div role="status" className="flex items-center gap-2 text-sm">
          {t('Загрузка…')}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => chatDrafts.cancelCitation(id, preparation.token)}
          >
            {t('Отменить добавление цитаты')}
          </Button>
        </div>
      )}
      {entry.conflict && (
        <div role="alert" className="space-y-2 rounded border border-amber-500 p-2 text-sm">
          <p>{t('Черновик изменён в другом окне. Ваша копия сохранена локально.')}</p>
          <details>
            <summary>{t('Серверная версия')}</summary>
            <p className="whitespace-pre-wrap">{entry.conflict.text}</p>
            <p>{t('Цитат: {{count}}', { count: entry.conflict.citation_ids.length })}</p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => chatDrafts.resolve(id, 'server')}
            >
              {t('Загрузить серверную версию')}
            </Button>
            <Button type="button" variant="outline" onClick={() => chatDrafts.resolve(id, 'local')}>
              {t('Сохранить мою версию')}
            </Button>
          </div>
        </div>
      )}
      <textarea
        ref={input}
        rows={5}
        className="max-h-80 min-h-32 w-full resize-y rounded-lg border bg-background p-3 text-sm focus:outline-primary"
        aria-label={t('Сообщение')}
        disabled={!entry.loaded && !entry.conversionError && !entry.error}
        maxLength={capabilities?.draft_text_char_limit ?? 16000}
        value={content.text}
        onChange={(e) => chatDrafts.edit(id, { text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (!blocked) void send()
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={blocked}>
          {t(entry.pending ? 'Повторить отправку' : 'Отправить')}
        </Button>
      </div>
      {!aiEnabled && (
        <p className="text-sm text-muted-foreground">
          {t('AI отключён. История и черновики доступны; новые ответы недоступны.')}
        </p>
      )}
      <div aria-live="polite" className="text-xs text-muted-foreground">
        {t(
          entry.sending
            ? 'Отправка…'
            : entry.saving
              ? 'Сохранение…'
              : entry.error || entry.conversionError
                ? 'Не сохранено на сервере'
                : entry.dirty
                  ? 'Черновик на этом устройстве'
                  : 'Черновик сохранён',
        )}
      </div>
      {!!entry.conversionError && !entry.conflict && !entry.pending && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            {t(
              'Не удалось перенести старые цитаты в сообщение. Повторите перенос или уберите старые цитаты; текст вопроса сохранится.',
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={entry.convertingCitations}
              onClick={() => void chatDrafts.load(id).catch(() => {})}
            >
              {t('Повторить перенос цитат')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={entry.convertingCitations}
              onClick={() => chatDrafts.removeLegacyCitations(id)}
            >
              {t('Убрать старые цитаты')}
            </Button>
          </div>
        </div>
      )}
      {!!entry.error && !entry.conversionError && !entry.conflict && (
        <div role="alert" className="text-sm">
          <p>
            {t(
              errorKey === 'source_changed' || errorKey === 'source_unavailable'
                ? 'Источник изменился или недоступен. Уберите цитату и приложите её заново.'
                : errorKey === 'inline_quote_too_large'
                  ? 'Цитата не помещается в сообщение. Сократите текст и попробуйте ещё раз.'
                  : errorKey === 'citation_too_large' ||
                      errorKey === 'attachment_count_limit' ||
                      errorKey === 'attachment_size_limit' ||
                      errorKey === 'context_limit'
                    ? 'Контекст слишком большой. Сократите сообщение или уберите цитаты.'
                    : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
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
              {t('Повторить сохранение')}
            </button>
          )}
        </div>
      )}
      {capabilities && (
        <p className="text-xs text-muted-foreground">
          {t('Лимит контекста: {{budget}} символов.', {
            budget: capabilities.context_char_budget,
          })}
        </p>
      )}
    </form>
  )
}
