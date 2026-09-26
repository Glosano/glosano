import { useEffect, useRef } from 'react'

import type { LessonHistoryDay } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'

import { DaySection } from './DaySection'

interface Props {
  days: LessonHistoryDay[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  // Off while the history query is in error: a still-visible sentinel would
  // otherwise re-request the failing page on every new observer. The button
  // below stays for a manual retry.
  autoLoad: boolean
}

export function HistorySection({
  days,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  autoLoad,
}: Props) {
  const t = useTranslation()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || !autoLoad || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, autoLoad])

  if (days.length === 0) return null
  return (
    <section aria-labelledby="library-history" className="py-4">
      <h2 id="library-history" className="text-lg font-semibold">
        {t('История')}
      </h2>
      {days.map((day) => (
        <DaySection key={day.date} day={day} />
      ))}
      <div ref={sentinelRef} className="flex justify-center py-4">
        {isFetchingNextPage && <p className="text-muted-foreground">{t('Загрузка…')}</p>}
        {hasNextPage && !isFetchingNextPage && (
          <Button variant="outline" onClick={fetchNextPage}>
            {t('Показать ещё')}
          </Button>
        )}
      </div>
    </section>
  )
}
