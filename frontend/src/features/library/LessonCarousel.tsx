import { useTranslation } from '@/lib/i18n'
import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { LessonSummary } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { LessonCard } from './LessonCard'

interface Props {
  items: LessonSummary[]
  variant?: 'continue' | 'history'
  /** Сколько материалов дня не пришло в ответе (total − items.length). */
  more?: number
}

export function LessonCarousel({ items, variant = 'history', more = 0 }: Props) {
  const t = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)

  function scroll(dir: 'left' | 'right') {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' })
  }

  if (items.length === 0) return null

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full"
        onClick={() => {
          scroll('left')
        }}
        aria-label={t('Предыдущий')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto px-12 py-4 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} variant={variant} />
        ))}
        {more > 0 && (
          <div className="flex w-[120px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            {t('ещё {{count}}', { count: more })}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full"
        onClick={() => {
          scroll('right')
        }}
        aria-label={t('Следующий')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
