import { Link } from '@tanstack/react-router'

import { useI18n } from '@/lib/i18n'
import type { LessonSummary } from '@/api/lessons'
import { LessonCover } from './LessonCover'
import { LessonActions } from './LessonActions'
import { LessonTagChips } from './LessonTagChips'
import { RetryVideoImport } from './RetryVideoImport'
import { formatLastActivity } from './libraryDates'

interface Props {
  lesson: LessonSummary
  variant?: 'continue' | 'history'
  /** Для тестов: «сегодня» для подписи последнего занятия. */
  today?: Date
}

export function LessonCard({ lesson, variant = 'history', today }: Props) {
  const { language, t } = useI18n()
  const plurals = new Intl.PluralRules(language)
  const wordForm = plurals.select(lesson.word_count)
  const wordLabel = wordForm === 'one' ? 'слово' : wordForm === 'few' ? 'слова' : 'слов'
  const newLabel = plurals.select(lesson.new_words_remaining) === 'one' ? 'новое' : 'новых'
  const notStarted = !lesson.completed_at && !lesson.last_activity_at && lesson.read_percent === 0
  return (
    <article className="relative w-[220px] shrink-0 overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md">
      <Link
        to="/learn/$lang/lessons/$lessonId"
        params={{ lang: lesson.language_code, lessonId: lesson.id }}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <LessonCover title={lesson.title} languageCode={lesson.language_code} />
        <div className="flex h-[110px] flex-col gap-2 p-3">
          <h4 className="line-clamp-2 text-sm font-medium leading-snug">{lesson.title}</h4>
          <div className="mt-auto space-y-1">
            {lesson.status === 'processing' && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('Обработка урока…')}
              </p>
            )}
            {lesson.completed_at && (
              <p className="text-xs text-primary">✓ {t('Материал завершён')}</p>
            )}
            {notStarted && lesson.status === 'ready' && (
              <p className="text-xs text-muted-foreground">{t('Не начат')}</p>
            )}
            {variant === 'continue' && lesson.last_activity_at && (
              <p className="text-xs text-muted-foreground">
                {formatLastActivity(lesson.last_activity_at, today ?? new Date(), language, t)}
              </p>
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
      </Link>
      {lesson.tags && lesson.tags.length > 0 && (
        <LessonTagChips lang={lesson.language_code} tags={lesson.tags} />
      )}
      {lesson.can_manage && lesson.status === 'failed' && lesson.source_type === 'youtube' && (
        <RetryVideoImport lessonId={lesson.id} lang={lesson.language_code} />
      )}
      <LessonActions lesson={lesson} />
    </article>
  )
}
