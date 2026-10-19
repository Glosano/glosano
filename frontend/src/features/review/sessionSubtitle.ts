import type { ReviewItemKind } from '@/api/review'
import { msg, type Translator } from '@/lib/i18n'

const ITEM_KIND_LABELS: Record<ReviewItemKind, string> = {
  token: msg('Words'),
  phrase: msg('Phrases'),
}

/**
 * Подзаголовок сессии: название режима и скоуп — урок и/или вид лексики,
 * выбранный вкладкой словаря (FLQ-34). Части без значения пропускаются.
 */
export function sessionSubtitle(
  t: Translator,
  scope: { title?: string; lessonId?: string; itemKind?: ReviewItemKind },
): string | undefined {
  const parts = [
    scope.title ? t(scope.title) : null,
    scope.lessonId ? t('Lesson vocabulary', { context: 'review' }) : null,
    scope.itemKind ? t(ITEM_KIND_LABELS[scope.itemKind]) : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
