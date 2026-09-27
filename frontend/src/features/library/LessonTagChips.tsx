import { useTranslation } from '@/lib/i18n'
import { useLibraryStore } from './libraryStore'

const VISIBLE_TAGS = 3

export function LessonTagChips({ lang, tags }: { lang: string; tags: string[] }) {
  const t = useTranslation()
  const addTag = useLibraryStore((s) => s.addTag)
  const hidden = tags.slice(VISIBLE_TAGS)
  return (
    <div className="flex flex-wrap gap-1 px-3 pb-3">
      {tags.slice(0, VISIBLE_TAGS).map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => addTag(lang, tag)}
          aria-label={t('Фильтровать по тегу «{{tag}}»', { tag })}
          className="max-w-full truncate rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80"
        >
          {tag}
        </button>
      ))}
      {hidden.length > 0 && (
        <span className="px-1 py-0.5 text-xs text-muted-foreground" title={hidden.join(', ')}>
          +{hidden.length}
        </span>
      )}
    </div>
  )
}
