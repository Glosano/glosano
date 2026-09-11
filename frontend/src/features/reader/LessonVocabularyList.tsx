import { useTranslation } from '@/lib/i18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import type { LessonVocabularyItem } from '@/api/reader'

import { selectVocabularyItems, vocabularyRowKey, type VocabularyTab } from './lessonVocabulary'
import { LessonVocabularyRow, type VocabularyRowAction } from './LessonVocabularyRow'
import { useLessonVocabulary } from './useReaderQueries'

interface Props {
  lessonId: string
  lang: string
  target: string
  tab: VocabularyTab
  onTabChange: (tab: VocabularyTab) => void
  scrollTop: number
  onScrollTopChange: (top: number) => void
  onSelect: (item: LessonVocabularyItem) => void
}

const LABELS: Record<VocabularyTab, string> = {
  added: 'Добавленные',
  new: 'Новые',
  all: 'Все',
}

const EMPTY: Record<VocabularyTab, string> = {
  added: 'Вы пока не добавили слова из этого урока',
  new: 'В этом уроке не осталось новых слов',
  all: 'В материале нет слов',
}

interface PendingFocus {
  key: string
  index: number
  action: VocabularyRowAction
}

export function LessonVocabularyList({
  lessonId,
  lang,
  target,
  tab,
  onTabChange,
  scrollTop,
  onScrollTopChange,
  onSelect,
}: Props) {
  const tr = useTranslation()
  const query = useLessonVocabulary(lessonId, target, true)
  const rows = useMemo(
    () => selectVocabularyItems(query.data?.items ?? [], tab, lang),
    [query.data?.items, tab, lang],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<PendingFocus | null>(null)
  const [focusRequest, setFocusRequest] = useState<PendingFocus | null>(null)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop
  }, [scrollTop, tab])

  useEffect(() => {
    if (!focusRequest) return
    const rowNodes = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-vocabulary-row-key]') ?? [],
    )
    const sameRow = rowNodes.find((node) => node.dataset.vocabularyRowKey === focusRequest.key)
    const focusButton = (row: HTMLElement | undefined, action: string) =>
      row?.querySelector<HTMLButtonElement>(`[data-vocabulary-action="${action}"]`) ??
      row?.querySelector<HTMLButtonElement>('[data-vocabulary-action="open"]')
    const target = sameRow
      ? focusButton(sameRow, focusRequest.action)
      : focusButton(
          rowNodes[focusRequest.index] ?? rowNodes[focusRequest.index - 1],
          focusRequest.action,
        )
    ;(
      target ??
      rootRef.current?.querySelector<HTMLButtonElement>('[role="tab"][data-state="active"]')
    )?.focus()
    setFocusRequest(null)
  }, [focusRequest, rows])

  function handleActionStart(key: string, action: VocabularyRowAction) {
    actionRef.current = {
      key,
      action,
      index: rows.findIndex((item) => vocabularyRowKey(item) === key),
    }
  }

  function handleActionComplete(key: string, action: VocabularyRowAction) {
    const pending = actionRef.current
    setFocusRequest(
      pending?.key === key && pending.action === action
        ? pending
        : { key, action, index: rows.findIndex((item) => vocabularyRowKey(item) === key) },
    )
    actionRef.current = null
  }

  const initialError = query.isError && !query.data
  const refetchError = query.isError && !!query.data

  return (
    <TabsPrimitive.Root
      ref={rootRef}
      value={tab}
      onValueChange={(value) => onTabChange(value as VocabularyTab)}
      className="flex h-[min(34rem,calc(85dvh-3.5rem))] min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div
        ref={scrollRef}
        data-testid="lesson-vocabulary-scroll"
        id="lesson-vocabulary-tabpanel"
        role="tabpanel"
        aria-label={tr('{{value0}} слова', { value0: tr(LABELS[tab]) })}
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {query.isPending && (
          <div aria-label={tr('Загрузка слов')} className="space-y-2 px-4 py-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}
        {initialError && (
          <div
            role="alert"
            className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <p>{tr('Не удалось загрузить слова')}</p>
            <button type="button" onClick={() => void query.refetch()} className="underline">
              {tr('Повторить')}
            </button>
          </div>
        )}
        {!query.isPending && !initialError && (
          <>
            {refetchError && (
              <div
                role="alert"
                className="mx-4 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {tr('Не удалось обновить список.')}{' '}
                <button type="button" onClick={() => void query.refetch()} className="underline">
                  {tr('Повторить')}
                </button>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {tr(EMPTY[tab])}
              </p>
            ) : (
              <ul aria-label={tr('{{value0}} слова', { value0: tr(LABELS[tab]) })}>
                {rows.map((item) => (
                  <LessonVocabularyRow
                    key={vocabularyRowKey(item)}
                    item={item}
                    lessonId={lessonId}
                    lang={lang}
                    target={target}
                    onOpen={onSelect}
                    onActionStart={handleActionStart}
                    onActionComplete={handleActionComplete}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <TabsPrimitive.List
        aria-label={tr('Разделы словаря урока')}
        className="grid shrink-0 grid-cols-3 border-t border-border bg-card"
      >
        {(Object.keys(LABELS) as VocabularyTab[]).map((value) => (
          <TabsPrimitive.Trigger
            key={value}
            value={value}
            aria-controls="lesson-vocabulary-tabpanel"
            className="min-h-14 border-t-2 border-transparent px-2 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground"
          >
            {tr(LABELS[value])}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
