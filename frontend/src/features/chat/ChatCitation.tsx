import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { chatsApi, type Citation } from '@/api/chats'
import { useTranslation } from '@/lib/i18n'
import { chatDrafts, useChatStore } from './chatStore'

export function ChatCitation({
  id,
  snapshot,
  draftId,
  onNavigate,
}: {
  id: string
  snapshot?: Citation
  draftId?: string | null
  onNavigate?: () => void
}) {
  const t = useTranslation(),
    navigate = useNavigate(),
    uid = useChatStore((s) => s.userId)
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false)
  const query = useQuery({
    queryKey: ['chats', uid, 'citation', id],
    queryFn: () => chatsApi.citation(id),
    enabled: !!uid,
    initialData: snapshot,
  })
  const citation = query.data
  async function openSource() {
    setBusy(true)
    setError(false)
    try {
      const source = await chatsApi.citation(id)
      if (useChatStore.getState().userId !== uid) return
      if (!source.source_available || !source.lesson_id) {
        setError(true)
        return
      }
      await navigate({
        to: '/learn/$lang/lessons/$lessonId',
        params: { lang: source.language_code, lessonId: source.lesson_id },
        search: source.source_current
          ? {
              sourceVersion: source.source_version,
              ordinal: source.from_ordinal,
              ...(source.paragraph_index != null ? { paragraphIndex: source.paragraph_index } : {}),
              sourceRequest: crypto.randomUUID(),
            }
          : {},
      })
      onNavigate?.()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="my-2 rounded-lg border bg-muted/30 p-3 text-sm" aria-label={t('Цитата')}>
      {citation ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <strong>{citation.title}</strong>
            {draftId !== undefined && (
              <button
                type="button"
                aria-label={t('Убрать цитату')}
                onClick={() =>
                  chatDrafts.edit(draftId, {
                    citation_ids: chatDrafts
                      .get(draftId)
                      .draft.citation_ids.filter((c) => c !== id),
                  })
                }
              >
                ×
              </button>
            )}
          </div>
          <blockquote className="mt-1 whitespace-pre-wrap break-words">
            {citation.selected_text}
          </blockquote>
          <details className="mt-2">
            <summary>{t('Сохранённый снимок контекста')}</summary>
            <p className="mt-2 whitespace-pre-wrap break-words">
              {citation.context_start_offset != null && citation.context_end_offset != null ? (
                <>
                  {Array.from(citation.context_text)
                    .slice(0, citation.context_start_offset)
                    .join('')}
                  <mark>
                    {Array.from(citation.context_text)
                      .slice(citation.context_start_offset, citation.context_end_offset)
                      .join('')}
                  </mark>
                  {Array.from(citation.context_text).slice(citation.context_end_offset).join('')}
                </>
              ) : (
                citation.context_text
              )}
            </p>
            <small>{t('Версия источника {{version}}', { version: citation.source_version })}</small>
          </details>
          {!citation.source_current && (
            <p className="mt-2 text-muted-foreground">
              {t(
                citation.source_available
                  ? 'Источник изменился. Откроется без старой позиции.'
                  : 'Источник недоступен. Снимок сохранён.',
              )}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-primary underline"
              disabled={busy || !citation.source_available}
              onClick={() => void openSource()}
            >
              {t('Открыть источник')}
            </button>
          </div>
        </>
      ) : (
        <p>{t(query.isError ? 'Не удалось загрузить цитату' : 'Загрузка…')}</p>
      )}
      {error && <p role="alert">{t('Источник недоступен или изменился. Снимок сохранён.')}</p>}
    </section>
  )
}
