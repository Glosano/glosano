import { intlLocale, useI18n, msg } from '@/lib/i18n'
import { useTranslationLanguage } from '@/lib/useTranslationLanguage'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { reviewApi, type ReviewItemKind } from '@/api/review'
import type { VocabListItem } from '@/api/vocabulary'
import { WordCard } from '@/features/reader/WordCard'
import { BulkActionsMenu, type BulkAction } from './BulkActionsMenu'
import { FilterPopover } from './FilterPopover'
import { PaginationNumbers } from './PaginationNumbers'
import { SearchInput } from './SearchInput'
import { useBulkAction, usePatchItem, useVocabInvalidate, useVocabList } from './useVocabularyQuery'
import { useVocabularyStore } from './vocabularyStore'
import { VocabularyCardList } from './VocabularyCardList'
import { VocabularyTable } from './VocabularyTable'

interface Props {
  lang: string
  tab: 'all' | 'words' | 'phrases'
}

const LINK_TABS = [
  { id: 'all', label: msg('All') },
  { id: 'words', label: msg('Words') },
  { id: 'phrases', label: msg('Phrases') },
] as const

/** Вид лексики вкладки: фильтрует список и скоуп кнопки повтора (FLQ-34). */
const TAB_KINDS: Partial<Record<Props['tab'], ReviewItemKind>> = {
  words: 'token',
  phrases: 'phrase',
}

const PAGE_SIZES = [25, 50, 100] as const

type SortOption = 'created_at:desc' | 'created_at:asc' | 'text:asc' | 'text:desc'

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'created_at:desc', label: msg('Newest first') },
  { id: 'created_at:asc', label: msg('Oldest first') },
  { id: 'text:asc', label: msg('A–Z') },
  { id: 'text:desc', label: msg('Z–A') },
]

const DAY_MS = 86400 * 1000

/**
 * Truncated to a UTC day boundary so the result is stable across renders
 * within the same day. Without this, computing `Date.now() - N*DAY_MS`
 * inline in render produces a millisecond-precision value that differs on
 * every render, changing the useVocabList queryKey and causing an infinite
 * refetch loop whenever addedPreset is '7d'/'30d'.
 */
export function addedAfterFromPreset(preset: 'all' | '7d' | '30d'): string | undefined {
  if (preset === 'all') return undefined
  const n = preset === '7d' ? 7 : 30
  const d = new Date(Date.now() - n * DAY_MS)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export function VocabularyPage({ lang, tab }: Props) {
  const { language: uiLanguage, t: tr } = useI18n()
  const targetLanguage = useTranslationLanguage()
  const navigate = useNavigate()
  const q = useVocabularyStore((s) => s.q)
  const statuses = useVocabularyStore((s) => s.statuses)
  const confidence = useVocabularyStore((s) => s.confidence)
  const tags = useVocabularyStore((s) => s.tags)
  const addedPreset = useVocabularyStore((s) => s.addedPreset)
  const sort = useVocabularyStore((s) => s.sort)
  const sortDir = useVocabularyStore((s) => s.sortDir)
  const page = useVocabularyStore((s) => s.page)
  const pageSize = useVocabularyStore((s) => s.pageSize)
  const selection = useVocabularyStore((s) => s.selection)
  const showAuto = useVocabularyStore((s) => s.showAuto)
  const dueOnly = useVocabularyStore((s) => s.dueOnly)
  const toggleSelected = useVocabularyStore((s) => s.toggleSelected)
  const selectMany = useVocabularyStore((s) => s.selectMany)
  const clearSelection = useVocabularyStore((s) => s.clearSelection)
  const setPage = useVocabularyStore((s) => s.setPage)
  const setPageSize = useVocabularyStore((s) => s.setPageSize)
  const setSort = useVocabularyStore((s) => s.setSort)
  const resetFilters = useVocabularyStore((s) => s.resetFilters)
  const filtersAreDefault = useVocabularyStore((s) => s.filtersAreDefault())

  const addedAfter = useMemo(() => addedAfterFromPreset(addedPreset), [addedPreset])

  const { data, isLoading, isError, refetch } = useVocabList({
    lang,
    target: targetLanguage,
    status: statuses,
    confidence_min: confidence?.[0],
    confidence_max: confidence?.[1],
    tag: tags,
    q: q || undefined,
    added_after: addedAfter,
    sort,
    sort_dir: sortDir,
    page,
    page_size: pageSize,
    kind: TAB_KINDS[tab] ?? 'all',
    added_by: showAuto ? 'all' : 'user',
    due: dueOnly || undefined,
  })
  // Счётчик на кнопке повтора: тот же ключ, что у плиток ModeSelect, — общий кэш
  // и общая инвалидация после ответов и правок словаря (FLQ-35).
  const reviewKind = TAB_KINDS[tab]
  const { data: reviewCounts } = useQuery({
    queryKey: ['review-counts', lang, null, reviewKind ?? null],
    queryFn: () => reviewApi.counts(lang, undefined, reviewKind),
  })
  const dueCount = reviewCounts?.due ?? 0
  const patchItem = usePatchItem()
  const bulk = useBulkAction()
  const invalidateVocabList = useVocabInvalidate()

  const [deletedToast, setDeletedToast] = useState<number | null>(null)
  const [bulkErrorVisible, setBulkErrorVisible] = useState(false)
  const [selectedItem, setSelectedItem] = useState<VocabListItem | null>(null)

  function handleCardClose() {
    setSelectedItem(null)
    invalidateVocabList()
  }

  useEffect(() => {
    if (deletedToast === null) return
    const timer = window.setTimeout(() => setDeletedToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [deletedToast])

  useEffect(() => {
    if (!bulkErrorVisible) return
    const timer = window.setTimeout(() => setBulkErrorVisible(false), 4000)
    return () => window.clearTimeout(timer)
  }, [bulkErrorVisible])

  function handleBulkAction(action: BulkAction, tagName?: string) {
    bulk.mutateAsync({ item_ids: selection, action, tag_name: tagName })
      .then((res) => {
        clearSelection()
        if (action === 'delete') setDeletedToast(res.affected)
      })
      .catch(() => { setBulkErrorVisible(true) })
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const showSkeleton = data === undefined && isLoading
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages)
  }, [data, page, totalPages, setPage])

  return (
    <div className="bg-[var(--vocab-page-bg)] [font-family:'Inter',system-ui,sans-serif]">
      <div className="mx-auto max-w-screen-2xl px-6">
      <h1 className="py-6 text-2xl font-bold tracking-tight">{tr('Vocabulary')}</h1>
      <div className="flex flex-wrap items-center gap-3 pb-5">
        {/* Below 640px the three tabs share the full width; long labels wrap (FLQ-32.3). */}
        <div className="grid w-full grid-cols-3 rounded-lg bg-[var(--vocab-subtabs-track)] p-0.5 sm:inline-flex sm:w-auto">
          {LINK_TABS.map((t) => {
            const active = tab === t.id
            return (
              <Link
                key={t.id}
                to="/learn/$lang/vocabulary"
                params={{ lang }}
                search={{ tab: t.id }}
                className={[
                  'flex min-h-8 min-w-0 items-center justify-center rounded-md px-0.5 py-1 text-center text-[12px] leading-tight hyphens-auto [overflow-wrap:anywhere] sm:h-8 sm:whitespace-nowrap sm:px-6 sm:text-[13px]',
                  active
                    ? 'border border-[#C7CCD4] bg-white font-semibold text-[var(--vocab-term-fg)] shadow-sm'
                    : 'text-[var(--vocab-muted-fg)]',
                ].join(' ')}
              >
                {tr(t.label)}
              </Link>
            )
          })}
        </div>
        {/* Below 1024px: search on its own row, then two rows of two controls pinned to
            the left and right edges, like the full-width tabs above (FLQ-32.3). */}
        <div className="grid w-full grid-cols-2 items-center gap-2 [&>*:nth-child(even)]:justify-self-start [&>*:nth-child(odd)]:justify-self-end lg:ml-auto lg:flex lg:w-auto lg:gap-3">
          <div className="col-span-2 w-full justify-self-stretch lg:w-auto">
            <SearchInput />
          </div>
          <FilterPopover />
          <Select
            value={`${sort}:${sortDir}`}
            onValueChange={(v) => {
              const [nextSort, nextSortDir] = v.split(':') as ['created_at' | 'text', 'asc' | 'desc']
              setSort(nextSort, nextSortDir)
            }}
          >
            <SelectTrigger size="sm" aria-label={tr('Sort order')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {tr(option.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <BulkActionsMenu count={selection.length} onAction={handleBulkAction} />
          <Button
            type="button"
            size="lg"
            className="bg-[#45B082] text-[13px] font-medium text-white hover:bg-[#3da075]"
            onClick={() => {
              navigate({
                to: '/learn/$lang/review',
                params: { lang },
                ...(reviewKind ? { search: { kind: reviewKind } } : {}),
              })
            }}
            aria-label={`${tr('⟳ Review vocabulary')}${dueCount > 0 ? ` (${dueCount})` : ''}`}
          >
            {/* Short label on phones so the counter fits beside «Ещё действия» (FLQ-32.11). */}
            <span>
              <span className="sm:hidden">{tr('⟳ Review')}</span>
              <span className="hidden sm:inline">{tr('⟳ Review vocabulary')}</span>
              {dueCount > 0 && ` (${dueCount})`}
            </span>
          </Button>
        </div>
      </div>
      <div className="pt-2 pb-6 lg:py-6">
        {showSkeleton && (
          <div data-testid="vocab-skeleton" className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}
        {!showSkeleton && isError && (
          <div
            data-testid="vocab-error"
            role="alert"
            className="mb-4 flex items-center justify-between rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span>{tr('Could not load vocabulary')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              {tr('Retry')}
            </Button>
          </div>
        )}
        {!showSkeleton && !isError && total === 0 && filtersAreDefault && (
          <div data-testid="vocab-empty-default" className="flex flex-col items-center justify-center py-20 text-center">
            <h2 className="text-xl font-semibold">{tr('Your vocabulary is empty')}</h2>
            <p className="mt-2 text-muted-foreground">
              {tr('Import a lesson and select words in the reader to add them here')}
            </p>
            <Button asChild className="mt-6">
              <Link to="/learn/$lang/library" params={{ lang }}>
                {tr('Go to library')}
              </Link>
            </Button>
          </div>
        )}
        {!showSkeleton && !isError && total === 0 && !filtersAreDefault && (
          <div data-testid="vocab-empty-filtered" className="flex flex-col items-center justify-center py-20 text-center">
            <h2 className="text-xl font-semibold">{tr('No results for these filters')}</h2>
            <Button type="button" variant="outline" className="mt-6" onClick={resetFilters}>
              {tr('Reset filters')}
            </Button>
          </div>
        )}
        {!showSkeleton && !isError && total > 0 && (
          <>
            {/* Below 1024px: total left, page size right, pagination centred below. */}
            <div className="grid grid-cols-2 items-center gap-x-4 gap-y-3 pb-5 lg:flex lg:justify-end">
              <div className="order-2 flex items-center gap-2 justify-self-end lg:order-1">
                <span className="text-sm text-muted-foreground">{tr('Show:')}</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v) as 25 | 50 | 100) }}
                >
                  <SelectTrigger size="sm" aria-label={tr('Page size')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="order-1 text-sm text-muted-foreground lg:order-2">
                {tr('Total:')} {total.toLocaleString(intlLocale(uiLanguage))}
              </span>
              <div className="order-3 col-span-2 justify-self-center">
                <PaginationNumbers page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            </div>
            <VocabularyTable
              items={items}
              selection={selection}
              onToggleSelected={toggleSelected}
              onSelectPage={selectMany}
              onClearSelection={clearSelection}
              onPick={(itemId, status, confidence) => {
                // onPick only carries the item id (row-agnostic prop
                // contract shared with VocabularyCardList) — resolve the
                // item's kind from the current page so the patch hits the
                // right endpoint (PATCH /items/token/{id} vs .../phrase/{id}).
                const kind = items.find((i) => i.item_id === itemId)?.kind ?? 'token'
                patchItem.mutate({ itemId, kind, status, confidence })
              }}
              onOpenTerm={setSelectedItem}
            />
            <VocabularyCardList
              items={items}
              selection={selection}
              onToggleSelected={toggleSelected}
              onSelectPage={selectMany}
              onClearSelection={clearSelection}
              onPick={(itemId, status, confidence) => {
                // onPick only carries the item id (row-agnostic prop
                // contract shared with VocabularyCardList) — resolve the
                // item's kind from the current page so the patch hits the
                // right endpoint (PATCH /items/token/{id} vs .../phrase/{id}).
                const kind = items.find((i) => i.item_id === itemId)?.kind ?? 'token'
                patchItem.mutate({ itemId, kind, status, confidence })
              }}
              onOpenTerm={setSelectedItem}
            />
          </>
        )}
      </div>

      {selectedItem && (
        <WordCard
          word={{
            kind: selectedItem.kind, t: selectedItem.text, n: selectedItem.text, i: -1,
            sentenceText: selectedItem.context,
          }}
          lang={lang}
          target={targetLanguage}
          lessonId={null}
          segId={null}
          sentenceText={null}
          onClose={handleCardClose}
        />
      )}

      {deletedToast !== null && (
        <div
          data-testid="bulk-deleted-toast"
          className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
        >
          <div className="rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg">
            {tr('Deleted {{value0}}', { value0: deletedToast.toLocaleString(intlLocale(uiLanguage)) })}
          </div>
        </div>
      )}

      {bulkErrorVisible && (
        <div
          data-testid="bulk-action-error"
          className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
        >
          <div className="rounded-full border border-destructive bg-card px-4 py-2 text-sm text-destructive shadow-lg">
            {tr('Could not complete the action')}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
