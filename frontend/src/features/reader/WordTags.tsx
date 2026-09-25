import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'

import { aiApi } from '@/api/ai'
import { ApiError } from '@/api/client'
import { vocabularyApi, type ItemKind, type WordLookup } from '@/api/vocabulary'
import { useI18n } from '@/lib/i18n'
import { invalidateVocabularyViews } from '@/lib/invalidateVocabularyViews'
import { useUserStore } from '@/stores/userStore'

export interface WordTagsHandle {
  saveForItem: (id: string) => Promise<void>
}

interface Props {
  ref: Ref<WordTagsHandle>
  data: WordLookup
  kind: ItemKind
  text: string
  lang: string
  context: string
  lessonId: string | null
  ensureItem: () => Promise<string>
}

/** Keyed by the selected occurrence so drafts and late AI results cannot cross words. */
export function WordTags({ ref, data, kind, text, lang, context, lessonId, ensureItem }: Props) {
  const { language, t: tr } = useI18n()
  const userId = useUserStore((s) => s.user?.id)
  const aiEnabled = useUserStore((s) => s.user?.ai_enabled !== false)
  const qc = useQueryClient()
  const isNew = data.item_id === null
  const [startedNew] = useState(isNew)
  const [showSuggestions, setShowSuggestions] = useState(isNew)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const dismissed = useRef(new Set<string>())
  const savedFor = useRef(new Set<string>())
  const retrySave = useRef<(() => Promise<void>) | null>(null)
  const queryOptions = {
    queryKey: ['word-tags', userId, lang, language, text, context],
    queryFn: () =>
      aiApi.wordTags({
        surface_text: text,
        context_text: context,
        language_code: lang,
        lesson_id: lessonId ?? undefined,
      }),
    staleTime: Infinity,
    retry: false as const,
  }
  const ai = useQuery({ ...queryOptions, enabled: aiEnabled && kind === 'token' && isNew })
  const aiDisabled = !aiEnabled || (ai.error instanceof ApiError && ai.error.status === 503)
  const suggested = (showSuggestions ? (ai.data?.tags ?? []) : []).filter(
    (tag) => !dismissed.current.has(tag),
  )
  const tags = [...new Set([...data.tags, ...suggested])].filter((tag) => !hidden.has(tag))
  const aiNames = new Set([
    ...(data.ai_tags ?? []),
    ...suggested.filter((tag) => !data.tags.includes(tag)),
  ])

  async function persist(id: string, names: string[]) {
    const remaining = names.filter((name) => !dismissed.current.has(name))
    if (!remaining.length) return
    await vocabularyApi.addTags(kind, id, remaining, 'ai')
    await invalidateVocabularyViews(qc)
  }

  async function saveSuggestions(id: string, names: string[]) {
    const action = () => persist(id, names)
    retrySave.current = action
    setBusy(true)
    try {
      await action()
      retrySave.current = null
      setShowSuggestions(false)
      setSaveError(false)
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  useImperativeHandle(ref, () => ({
    async saveForItem(id) {
      if (!startedNew || kind !== 'token' || aiDisabled || savedFor.current.has(id)) return
      savedFor.current.add(id)
      // Join the original request even if the user saves before it finishes,
      // or navigates away. The captured id and query belong to this occurrence.
      try {
        const result = await qc.fetchQuery(queryOptions)
        await saveSuggestions(id, result.tags)
      } catch {
        // AI failure must never fail the user's word/translation save.
      }
    },
  }))

  async function generate() {
    setBusy(true)
    setShowSuggestions(true)
    const result = await ai.refetch()
    if (result.data && !result.error) {
      dismissed.current.clear()
      setHidden(new Set())
      if (data.item_id) await saveSuggestions(data.item_id, result.data.tags)
    }
    setBusy(false)
  }

  async function addManual() {
    const value = draft.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const id = data.item_id ?? (await ensureItem())
      await vocabularyApi.addTag(kind, id, value)
      dismissed.current.delete(value)
      setHidden((previous) => new Set([...previous].filter((tag) => tag !== value)))
      await invalidateVocabularyViews(qc)
      setDraft('')
      setAdding(false)
      setSaveError(false)
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  async function remove(name: string) {
    setBusy(true)
    try {
      if (data.tags.includes(name) && data.item_id) {
        await vocabularyApi.removeTag(kind, data.item_id, name)
        await invalidateVocabularyViews(qc)
      }
      dismissed.current.add(name)
      setHidden((previous) => new Set([...previous, name]))
      setSaveError(false)
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="word-tags" className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex max-w-full items-center gap-1">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs leading-5 break-words">
              {tag}
            </span>
            {aiNames.has(tag) && (
              <span className="text-[10px] text-muted-foreground" aria-label={tr('Создано AI')}>
                AI
              </span>
            )}
            {editing && (
              <button
                type="button"
                disabled={busy}
                aria-label={tr('Удалить тег: {{value0}}', { value0: tag })}
                onClick={() => void remove(tag)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="px-1 py-0.5 text-xs underline underline-offset-2"
        >
          {tr('Тег+')}
        </button>
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="px-1 py-0.5 text-xs text-muted-foreground underline underline-offset-2"
          >
            {editing ? tr('Готово') : tr('Изменить теги')}
          </button>
        )}
        {kind === 'token' && !aiDisabled && (!isNew || ai.isError) && (
          <button
            type="button"
            disabled={busy || ai.isFetching}
            onClick={() => void generate()}
            className="px-1 py-0.5 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
          >
            {tr('Получить AI-теги')}
          </button>
        )}
      </div>
      {adding && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addManual()
          }}
        >
          <input
            autoFocus
            aria-label={tr('Новый тег')}
            placeholder={tr('Тег+')}
            maxLength={64}
            disabled={busy}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addManual()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                setAdding(false)
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="text-xs text-primary disabled:opacity-50"
          >
            {tr('Добавить тег')}
          </button>
        </form>
      )}
      {ai.isFetching && (
        <p role="status" className="text-xs text-muted-foreground">
          {tr('Определяем грамматику…')}
        </p>
      )}
      {ai.isError && !aiDisabled && (
        <p className="text-xs text-muted-foreground">{tr('Не удалось получить AI-теги')}</p>
      )}
      {ai.isSuccess && ai.data.tags.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {tr('AI не определил теги. Можно добавить вручную.')}
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-xs text-destructive">
          {tr('Не удалось сохранить теги')}
          {retrySave.current && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                const retry = retrySave.current
                if (retry)
                  void retry()
                    .then(() => {
                      retrySave.current = null
                      setShowSuggestions(false)
                      setSaveError(false)
                    })
                    .catch(() => setSaveError(true))
              }}
            >
              {tr('Повторить сохранение тегов')}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
