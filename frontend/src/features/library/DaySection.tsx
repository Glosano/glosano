import type { LessonHistoryDay } from '@/api/lessons'
import { useI18n } from '@/lib/i18n'

import { LessonCarousel } from './LessonCarousel'
import { formatDayHeading } from './libraryDates'

export function DaySection({ day }: { day: LessonHistoryDay }) {
  const { language, t } = useI18n()
  const headingId = `library-day-${day.date}`
  return (
    <section aria-labelledby={headingId} className="py-2">
      <h3 id={headingId} className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {formatDayHeading(day.date, new Date(), language, t)}
      </h3>
      <LessonCarousel items={day.items} more={day.total - day.items.length} />
    </section>
  )
}
