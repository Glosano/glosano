import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import { lessonsApi } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'

import { ContinueSection } from './ContinueSection'
import { FilterRow } from './FilterRow'
import { HistorySection } from './HistorySection'
import { LibraryEmptyState } from './LibraryEmptyState'
import { useLibraryStore, useSelectedTags } from './libraryStore'

export function LibraryView({ lang }: { lang: string }) {
  const t = useTranslation()
  const search = useLibraryStore((s) => s.search)
  const clearTags = useLibraryStore((s) => s.clearTags)
  const tags = useSelectedTags(lang)
  const q = search || undefined
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Оба ключа начинаются с ['lessons', lang]: импорт, правка и ридер уже
  // инвалидируют этот префикс, и экран обновится без новых вызовов.
  const continueQuery = useQuery({
    queryKey: ['lessons', lang, 'continue', search, tags],
    queryFn: () => lessonsApi.continue(lang, { q, tag: tags }),
  })
  const historyQuery = useInfiniteQuery({
    queryKey: ['lessons', lang, 'history', search, tags, tz],
    queryFn: ({ pageParam }) => lessonsApi.history(lang, { q, tz, before: pageParam, tag: tags }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  })

  const { fetchNextPage } = historyQuery
  const loadMore = useCallback(() => {
    void fetchNextPage()
  }, [fetchNextPage])

  const continueItems = continueQuery.data?.items ?? []
  const days = historyQuery.data?.pages.flatMap((page) => page.days) ?? []
  const loading = continueQuery.isLoading || historyQuery.isLoading
  const failed = continueQuery.isError || historyQuery.isError
  const empty = !loading && !failed && continueItems.length === 0 && days.length === 0

  return (
    <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
      <FilterRow lang={lang} />
      {loading && <p className="text-muted-foreground">{t('Загрузка…')}</p>}
      {failed && <p className="text-destructive">{t('Ошибка загрузки уроков')}</p>}
      {empty &&
        (search || tags.length > 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
            <p>{t('Ничего не найдено')}</p>
            {tags.length > 0 && (
              <Button variant="outline" onClick={clearTags}>
                {t('Сбросить фильтр')}
              </Button>
            )}
          </div>
        ) : (
          <LibraryEmptyState />
        ))}
      <ContinueSection items={continueItems} />
      <HistorySection
        days={days}
        hasNextPage={historyQuery.hasNextPage}
        isFetchingNextPage={historyQuery.isFetchingNextPage}
        fetchNextPage={loadMore}
        autoLoad={!historyQuery.isError}
      />
    </div>
  )
}
