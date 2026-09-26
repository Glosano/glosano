import type { LessonSummary } from '@/api/lessons'
import { useTranslation } from '@/lib/i18n'

import { LessonCarousel } from './LessonCarousel'

export function ContinueSection({ items }: { items: LessonSummary[] }) {
  const t = useTranslation()
  if (items.length === 0) return null
  return (
    <section aria-labelledby="library-continue" className="py-4">
      <h2 id="library-continue" className="text-lg font-semibold">
        {t('Продолжить изучение')}
      </h2>
      <LessonCarousel items={items} variant="continue" />
    </section>
  )
}
