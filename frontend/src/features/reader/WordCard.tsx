import { useTranslation } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronDown, ChevronUp } from 'lucide-react'

import { useWordLookup, useWordCardMutations } from './useWordCard'
import { TranslationFields } from './TranslationFields'
import { WordTags, type WordTagsHandle } from './WordTags'
import { useReaderStore } from './readerStore'
import { dictionaryApi } from '@/api/dictionary'
import { aiApi } from '@/api/ai'
import { ApiError } from '@/api/client'
import { ConfidencePicker } from '@/components/ConfidencePicker'
import type { SelectedItem } from './selectedItem'

/** Suggestions shown before the card is expanded; the expanded card shows all. */
const COLLAPSED_SUGGESTION_LIMIT = 15

interface Props {
  word: SelectedItem | null
  lang: string
  target: string
  lessonId: string | null
  segId: string | null
  onClose: () => void
  /** Явное действие со статусом («добавили в обучение») — ридер по нему
      гасит подсветку выделения, не закрывая карточку. */
  onStatusApplied?: () => void
  onTranslationSelected?: () => void
  sentenceText: string | null
  embedded?: boolean
  closeLabel?: string
  onAddToChat?: (newConversation: boolean) => void
  canAddToChat?: boolean
}

export function WordCard({
  word,
  lang,
  target,
  lessonId,
  segId,
  onClose,
  onStatusApplied,
  onTranslationSelected,
  sentenceText,
  embedded = false,
  closeLabel,
  onAddToChat,
  canAddToChat,
}: Props) {
  const tr = useTranslation()
  const expanded = useReaderStore((s) => s.wordCardExpanded)
  const setExpanded = useReaderStore((s) => s.setWordCardExpanded)
  const kind = word?.kind ?? 'token'
  // Phrase lookups must send the raw surface text: server-side
  // `normalize_phrase` is not idempotent, so re-normalizing an already
  // normalized phrase key (as `word.n` would be) can compute a DIFFERENT
  // key than the one `createItem` saved from the surface. Token
  // normalization IS idempotent, so tokens keep using `word.n`.
  const text = word ? (kind === 'phrase' ? word.t : word.n) : null
  const lookup = useWordLookup(lang, text, target, kind)
  const m = useWordCardMutations({
    kind,
    lang,
    text: text ?? '',
    surfaceText: word?.t ?? '',
    target,
    lessonId,
    segId,
  })

  const data = lookup.data
  const itemId = data?.item_id ?? null
  const status = data?.status ?? 'new'
  const confidence = data?.confidence ?? null

  // MUST be memoized: TranslationFields resets its per-field drafts when the
  // `translations` prop identity changes, so a fresh `.filter()` array on
  // every render would wipe the user's typing mid-edit.
  const variants = useMemo(
    () => (data?.translations.all ?? []).filter((t) => t.target_language_code === target),
    [data, target],
  )

  // AI suggestion for `new` and `known` words (needs lesson context; guarded).
  // Gate on `data?.status` directly (not the defaulted `status` above) so we
  // never fire the AI query before the lookup has told us the real status —
  // `status` defaults to 'new' pre-lookup, which would otherwise race an
  // AI call for a word that turns out to be tracked/ignored.
  const wantAi = data?.status === 'new' || data?.status === 'known'
  const aiContext = word?.sentenceText ?? sentenceText ?? word?.t ?? ''
  const dict = useQuery({
    queryKey: ['dict', lang, target, text ?? ''],
    queryFn: () => dictionaryApi.lookup(lang, target, text as string),
    enabled: text !== null && kind === 'token',
  })
  const ai = useQuery({
    queryKey: ['ai-hint', lang, target, text ?? '', aiContext],
    queryFn: () =>
      aiApi.translate({
        surface_text: word!.t,
        context_text: aiContext,
        target_language_code: target,
        lesson_id: lessonId ?? undefined,
      }),
    enabled: text !== null && wantAi,
    retry: false,
  })
  const aiDisabled = ai.error instanceof ApiError && ai.error.status === 503

  const [saveError, setSaveError] = useState(false)
  const [suggestionError, setSuggestionError] = useState(false)

  const tagsRef = useRef<WordTagsHandle>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const noteSavedRef = useRef<string>('')
  useEffect(() => {
    const n = data?.note ?? ''
    setNoteDraft(n)
    noteSavedRef.current = n
  }, [data?.item_id, data?.note])

  async function saveNote() {
    const value = noteDraft
    if (value === noteSavedRef.current) return
    const prev = noteSavedRef.current
    noteSavedRef.current = value
    try {
      await withItem((id) => m.saveNote.mutateAsync({ itemId: id, note: value }))
      setSaveError(false)
    } catch {
      noteSavedRef.current = prev
      setSaveError(true)
    }
  }

  useEffect(() => {
    if (!word) return
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-reader-panel-popover]')) return
      if (!embedded && e.key === 'Escape') onClose()
      const target = e.target instanceof HTMLElement ? e.target : null
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      if (isEditableTarget || target?.closest('[data-reader-panel-popover]')) return
      if (data && /^[1-4]$/.test(e.key)) applyStatus('tracked', Number(e.key))
      if (data && e.key === 'k') applyStatus('known', null)
      if (data && e.key === 'i') applyStatus('ignored', null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, data, embedded])

  if (!word) return null

  async function ensureItem(nextStatus: 'tracked' | 'known' | 'ignored', conf: number | null) {
    const tags = tagsRef.current
    const res = await m.setStatus.mutateAsync({ itemId, status: nextStatus, confidence: conf })
    if (!itemId) void tags?.saveForItem(res.item_id)
    return res.item_id
  }

  function applyStatus(nextStatus: 'tracked' | 'known' | 'ignored', conf: number | null) {
    onStatusApplied?.()
    void ensureItem(nextStatus, conf).catch(() => setSaveError(true))
  }

  async function withItem(fn: (id: string) => Promise<unknown>): Promise<void> {
    // ADR-0005: new → tracked стартует с confidence 1.
    const id = itemId ?? (await ensureItem('tracked', 1))
    await fn(id)
  }

  const dictionarySource = dict.data?.attribution.source || 'Wiktionary'
  type Suggestion = {
    text: string
    fromAi: boolean
    fromDictionary: boolean
  }
  // AI hints first, dictionary senses below. Same text (case/space-insensitive)
  // collapses into the first row, which then carries both sources.
  const suggestions: Suggestion[] = []
  const byKey = new Map<string, Suggestion>()
  const addSuggestion = (raw: string, source: 'ai' | 'dictionary') => {
    const text = raw.trim()
    if (!text) return
    const key = text.toLocaleLowerCase()
    const existing = byKey.get(key)
    const sug = existing ?? { text, fromAi: false, fromDictionary: false }
    if (source === 'ai') sug.fromAi = true
    else sug.fromDictionary = true
    if (!existing) {
      byKey.set(key, sug)
      suggestions.push(sug)
    }
  }
  for (const h of ai.data?.hints ?? []) addSuggestion(h.text, 'ai')
  for (const e of dict.data?.entries ?? []) {
    for (const s of e.senses) addSuggestion(s.translation, 'dictionary')
  }
  const visibleSuggestions = expanded
    ? suggestions
    : suggestions.slice(0, COLLAPSED_SUGGESTION_LIMIT)
  const showDictionaryAttribution = visibleSuggestions.some((sug) => sug.fromDictionary)
  // Reserve the AI slot above dictionary rows so they don't jump when AI lands.
  const aiPending = wantAi && ai.isLoading
  const isIgnored = data?.status === 'ignored'

  const content = (
    <div
      data-testid="word-card"
      className={
        embedded
          ? 'relative min-h-0 p-4'
          : 'fixed inset-x-0 bottom-0 z-[var(--z-modal)] rounded-t-xl border border-border bg-card p-4 shadow-lg md:inset-x-auto md:right-0 md:top-16 md:h-[calc(100vh-4rem)] md:w-80 md:overflow-y-auto md:rounded-none md:border-y-0 md:border-r-0 md:border-l md:shadow-none'
      }
    >
      <button
        type="button"
        aria-label={closeLabel ?? tr('Закрыть')}
        onClick={onClose}
        className="absolute right-3 top-3 rounded-md p-1 hover:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="text-2xl font-semibold">{word.t}</p>
      {kind === 'token' && lessonId && (
        <p className="mt-1 hidden text-xs text-muted-foreground [@media(hover:none)]:block">
          {tr('Удерживайте слово и ведите пальцем, чтобы выделить фразу')}
        </p>
      )}
      {data && (
        <WordTags
          key={`${kind}:${lang}:${text}:${aiContext}`}
          ref={tagsRef}
          data={data}
          kind={kind}
          text={word.t}
          lang={lang}
          context={aiContext}
          lessonId={lessonId}
          ensureItem={() => ensureItem('tracked', 1)}
        />
      )}

      {onAddToChat && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!canAddToChat}
              className="text-primary underline disabled:opacity-50"
              onClick={() => onAddToChat(false)}
            >
              {tr('Добавить в чат')}
            </button>
            <button
              type="button"
              disabled={!canAddToChat}
              className="underline disabled:opacity-50"
              onClick={() => onAddToChat(true)}
            >
              {tr('В новый разговор')}
            </button>
          </div>
          {!canAddToChat && (
            <p className="text-muted-foreground">
              {tr('Выделите фрагмент в тексте, чтобы приложить точную цитату.')}
            </p>
          )}
        </div>
      )}

      {!isIgnored && (
        <>
          {/* Saved translation */}
          <label className="mt-4 block text-sm font-medium">{tr('Перевод')}</label>
          <TranslationFields
            key={`${kind}:${text}:${target}`}
            translations={variants}
            onCreate={(value) =>
              withItem((id) =>
                m.saveTranslation.mutateAsync({ itemId: id, text: value, source: 'user', target }),
              )
            }
            onUpdate={(translationId, value) =>
              withItem((id) =>
                m.updateTranslation.mutateAsync({ itemId: id, translationId, text: value }),
              )
            }
            onDelete={(translationId) =>
              withItem((id) => m.deleteTranslation.mutateAsync({ itemId: id, translationId }))
            }
          />

          <div data-testid="word-card-suggestions" className="mt-4">
            {dict.data?.availability === 'not_installed' && (
              <p className="mb-2 text-sm text-muted-foreground">
                {tr(
                  'Словарь для этой языковой пары не установлен. Можно добавить перевод вручную.',
                )}
              </p>
            )}
            {(visibleSuggestions.length > 0 || aiPending) && (
              <p className="text-sm font-medium">{tr('Подсказки')}</p>
            )}
            <ul className="mt-1 space-y-1">
              {aiPending && (
                <li
                  data-testid="word-card-ai-pending"
                  className="flex animate-pulse items-center rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                >
                  {tr('Переводим…')}
                  <span aria-hidden="true" className="ml-2">
                    ✦
                  </span>
                </li>
              )}
              {visibleSuggestions.map((sug) => {
                const sourceLabel = [sug.fromAi && 'AI', sug.fromDictionary && dictionarySource]
                  .filter(Boolean)
                  .join(' · ')
                // A dictionary match confirms the AI draft, so save it as dictionary data.
                const saveSource = sug.fromDictionary ? 'dictionary' : 'ai'
                return (
                  <li key={sug.text.toLocaleLowerCase()}>
                    <button
                      type="button"
                      aria-label={
                        sug.fromDictionary
                          ? tr('Добавить перевод из {{value0}}: {{value1}}', {
                              value0: sourceLabel,
                              value1: sug.text,
                            })
                          : tr('Добавить AI перевод: {{value0}}', { value0: sug.text })
                      }
                      onClick={() => {
                        setSuggestionError(false)
                        void withItem((id) =>
                          m.saveTranslation.mutateAsync({
                            itemId: id,
                            text: sug.text,
                            source: saveSource,
                            target,
                          }),
                        )
                          .then(() => onTranslationSelected?.())
                          .catch(() => setSuggestionError(true))
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="text-primary">
                        <span data-suggestion-text>{sug.text}</span>
                        <span aria-hidden="true" className="ml-2 text-muted-foreground">
                          {[sug.fromAi && '✦', sug.fromDictionary && '📘'].filter(Boolean).join(' ')}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{sourceLabel}</span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 p-1">
                        +
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {suggestionError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {tr('Не удалось сохранить')}
              </p>
            )}
            {showDictionaryAttribution && dict.data?.attribution && (
              <p className="mt-2 text-xs text-muted-foreground">
                {tr('Источник:')}{' '}
                {dict.data.attribution.url ? (
                  <a
                    href={dict.data.attribution.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {dict.data.attribution.source}
                  </a>
                ) : (
                  <span>{dict.data.attribution.source}</span>
                )}
                {dict.data.attribution.license && (
                  <>
                    {' · '}
                    <span>{dict.data.attribution.license}</span>
                  </>
                )}
              </p>
            )}
            {ai.isError && !aiDisabled && (
              <p className="mt-1 text-sm text-destructive">
                {tr('Не удалось получить AI-перевод')}{' '}
                <button type="button" onClick={() => void ai.refetch()} className="underline">
                  {tr('Повторить')}
                </button>
              </p>
            )}
          </div>
        </>
      )}

      {isIgnored && (
        <div data-testid="word-card-ignored" className="mt-4">
          <p className="text-sm font-medium">{tr('Игнорируется')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr('Выберите уровень 1–4 или ✓, чтобы вернуть слово в изучение')}
          </p>
        </div>
      )}

      {expanded && !isIgnored && (
        <div data-testid="word-card-expanded" className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium">{tr('Заметки')}</p>
            <textarea
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              rows={3}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => void saveNote()}
            />
            {saveError && (
              <p className="mt-1 text-sm text-destructive">{tr('Не удалось сохранить')}</p>
            )}
          </div>
        </div>
      )}

      {/* Footer: 🗑 [1][2][3][4] ✓ — gated on the lookup having loaded, so a
          click always sees the real item id/status (never a stale "new word"
          default while the lookup is still in flight). */}
      {data && (
        <div className="mt-4 border-t border-border pt-3">
          <ConfidencePicker
            status={status}
            confidence={confidence}
            onSelect={(s, c) => applyStatus(s, c)}
          />
        </div>
      )}

      {!isIgnored && (
        <button
          type="button"
          aria-label={expanded ? tr('Свернуть') : tr('Развернуть')}
          onClick={() => setExpanded(!expanded)}
          className="mx-auto mt-2 flex rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
    </div>
  )

  if (embedded) return content

  return (
    <>
      <div
        data-testid="word-card-backdrop"
        className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/10 md:hidden"
        onClick={onClose}
      />
      {content}
    </>
  )
}
