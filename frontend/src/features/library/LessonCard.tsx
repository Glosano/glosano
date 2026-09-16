import { useI18n } from '@/lib/i18n'
import type { LessonSummary } from '@/api/lessons'
import { LessonCover } from './LessonCover'
import { LessonActions } from './LessonActions'

interface Props {
  lesson: LessonSummary
}

export function LessonCard({ lesson }: Props) {
  const { language, t } = useI18n()
  const plurals = new Intl.PluralRules(language)
  const wordForm = plurals.select(lesson.word_count)
  const wordLabel = wordForm === 'one' ? 'слово' : wordForm === 'few' ? 'слова' : 'слов'
  const newLabel = plurals.select(lesson.new_words_remaining) === 'one' ? 'новое' : 'новых'
  return (
    <article className="relative w-[220px] shrink-0 overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md">
      <a
        href={`/learn/${lesson.language_code}/lessons/${lesson.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <LessonCover title={lesson.title} languageCode={lesson.language_code} />
        <div className="flex h-[110px] flex-col gap-2 p-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{lesson.title}</h3>
          <div className="mt-auto space-y-1">
            {lesson.completed_at && (
              <p className="text-xs text-primary">✓ {t('Материал завершён')}</p>
            )}
            <div
              role="progressbar"
              aria-valuenow={lesson.read_percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('Прочитано {{value0}}%', { value0: lesson.read_percent.toString() })}
              className="h-1 w-full rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${lesson.read_percent.toString()}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('{{percent}}% · {{count}} {{words}} · {{newCount}} {{newWords}}', {
                percent: lesson.read_percent,
                count: lesson.word_count,
                words: t(wordLabel),
                newCount: lesson.new_words_remaining,
                newWords: t(newLabel),
              })}
            </p>
          </div>
        </div>
      </a>
      {lesson.can_manage && <LessonActions lesson={lesson} />}
    </article>
  )
}
