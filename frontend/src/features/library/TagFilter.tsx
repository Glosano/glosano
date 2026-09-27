import { useQuery } from '@tanstack/react-query'

import { lessonsApi } from '@/api/lessons'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useLibraryStore, useSelectedTags } from './libraryStore'

export function TagFilter({ lang }: { lang: string }) {
  const t = useTranslation()
  const selectedTags = useSelectedTags(lang)
  const toggleTag = useLibraryStore((s) => s.toggleTag)
  const clearTags = useLibraryStore((s) => s.clearTags)
  // Under ['lessons', lang] so imports and tag edits refresh it with the lists.
  const { data } = useQuery({
    queryKey: ['lessons', lang, 'tags'],
    queryFn: () => lessonsApi.tags(lang),
  })
  // A selected tag stays even after its last lesson lost it, so it can be deselected.
  const names = [...new Set([...(data?.tags ?? []).map((tag) => tag.name), ...selectedTags])]
  if (names.length === 0) return null
  return (
    <div
      role="group"
      aria-label={t('Фильтр по тегам')}
      className="-mt-2 flex items-center gap-2 overflow-x-auto pb-4"
    >
      {names.map((name) => {
        const active = selectedTags.includes(name)
        return (
          <button
            key={name}
            type="button"
            aria-pressed={active}
            onClick={() => toggleTag(lang, name)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {name}
          </button>
        )
      })}
      {selectedTags.length > 0 && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={clearTags}>
          {t('Сбросить теги')}
        </Button>
      )}
    </div>
  )
}
