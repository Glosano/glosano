import { useTranslation } from '@/lib/i18n'
import type { VocabListItem } from '@/api/vocabulary'
import { ConfidencePicker } from '@/components/ConfidencePicker'

const CONTEXT_MAX = 80

interface Props {
  items: VocabListItem[]
  selection: string[]
  onToggleSelected: (id: string) => void
  onSelectPage: (ids: string[]) => void
  onClearSelection: () => void
  onPick: (
    itemId: string,
    status: 'tracked' | 'known' | 'ignored',
    confidence: number | null,
  ) => void
  onOpenTerm: (item: VocabListItem) => void
}

function truncateContext(context: string): string {
  return context.length > CONTEXT_MAX ? `${context.slice(0, CONTEXT_MAX)}…` : context
}

/**
 * Vocabulary card list below 1024px (FLQ-32.3) — one column on phones, two on
 * tablets; same contract as VocabularyTable. Touch targets grow only on coarse
 * pointers so mouse users keep the compact look.
 */
export function VocabularyCardList({
  items,
  selection,
  onToggleSelected,
  onSelectPage,
  onClearSelection,
  onPick,
  onOpenTerm,
}: Props) {
  const tr = useTranslation()
  const pageIds = items.map((item) => item.item_id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.includes(id))
  return (
    <div data-testid="vocab-card-list" className="lg:hidden">
      <label className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--vocab-muted-fg)]">
        <input
          type="checkbox"
          aria-label={tr('Выбрать все на странице')}
          checked={allSelected}
          onChange={() => (allSelected ? onClearSelection() : onSelectPage(pageIds))}
          className="size-4"
        />
        <span aria-hidden>{tr('Выбрать все на странице')}</span>
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.item_id}
            data-testid="vocab-card"
            className="relative rounded-lg border border-[var(--vocab-card-border)] bg-white p-4"
          >
            {/* 44×44 hit area around a normal-size checkbox. */}
            <label className="absolute right-0 top-0 flex size-11 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                aria-label={tr('Выбрать {{value0}}', { value0: item.text })}
                checked={selection.includes(item.item_id)}
                onChange={() => onToggleSelected(item.item_id)}
                className="size-4"
              />
            </label>
            <div className="flex items-start justify-between gap-3 pr-8">
              <button
                type="button"
                onClick={() => onOpenTerm(item)}
                className="text-left text-[15px] font-semibold text-[var(--vocab-term-fg)] hover:underline"
              >
                {item.text}
              </button>
              <span className="text-right text-sm text-[var(--vocab-translation-fg)]">
                {item.primary_translation !== null ? (
                  item.primary_translation.text
                ) : (
                  <span className="text-[var(--vocab-muted-fg)]">—</span>
                )}
              </span>
            </div>
            {(item.pos !== null || item.tags.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {item.pos !== null && (
                  <span className="h-5 rounded px-1.5 text-[11px] leading-5 bg-[var(--vocab-chip-pos-bg)]">
                    {item.pos}
                  </span>
                )}
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="h-5 rounded px-1.5 text-[11px] leading-5 bg-[var(--vocab-chip-gram-bg)]"
                  >
                    {tag}
                    {item.ai_tags?.includes(tag) && (
                      <span
                        className="ml-1 text-[10px] text-muted-foreground"
                        aria-label={tr('Создано AI')}
                      >
                        AI
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {item.context !== null && (
              <p className="mt-2 text-[13px] italic text-[var(--vocab-muted-fg)]">
                «{truncateContext(item.context)}»
              </p>
            )}
            <div className="mt-3 border-t border-border pt-2">
              <ConfidencePicker
                status={item.status}
                confidence={item.confidence}
                onSelect={(status, confidence) => onPick(item.item_id, status, confidence)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
