import { useTranslation } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { reviewApi, type ReviewItemKind, type ReviewMode } from '@/api/review'
import { sessionSubtitle } from './sessionSubtitle'

const GROUPS: {
  title: string
  key: 'due' | 'new' | 'practice' | 'fill'
  practice?: boolean
  modes: { mode: ReviewMode; title: string; hint: string; ai: boolean }[]
}[] = [
  {
    title: 'Знакомство',
    key: 'new',
    modes: [{ mode: 'new', title: 'Новые слова', hint: 'AI-пример и первое знакомство', ai: true }],
  },
  {
    title: 'Повторение по расписанию',
    key: 'due',
    modes: [
      { mode: 'cards', title: 'Карточки', hint: 'Вспомните значение и раскройте ответ', ai: false },
      {
        mode: 'cloze',
        title: 'Квиз: пропуск',
        hint: 'Предложение с пропуском, 4 варианта',
        ai: true,
      },
      { mode: 'reverse', title: 'Квиз: перевод', hint: 'Слово и 4 варианта перевода', ai: true },
    ],
  },
  {
    title: 'Дополнительная практика',
    key: 'fill',
    practice: true,
    modes: [
      {
        mode: 'fill',
        title: 'Вставить слово',
        hint: 'Введите пропущенное слово или фразу',
        ai: true,
      },
      {
        mode: 'translation',
        title: 'Практика перевода',
        hint: 'Переведи предложение, AI проверит',
        ai: true,
      },
    ],
  },
]

export function ModeSelect({
  lang,
  lessonId,
  itemKind,
  from,
}: {
  lang: string
  lessonId?: string
  itemKind?: ReviewItemKind
  from?: 'completion'
}) {
  const t = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['review-counts', lang, lessonId ?? null, itemKind ?? null],
    queryFn: () => reviewApi.counts(lang, lessonId, itemKind),
  })
  const scope = sessionSubtitle(t, { lessonId, itemKind })
  const countText = (key: 'due' | 'new' | 'practice' | 'fill') =>
    t('Доступно: {{total}} · В занятии: {{count}}', {
      total: data?.[key] ?? 0,
      count: data?.session_sizes?.[key] ?? data?.[key] ?? 0,
    })
  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-center text-xl font-semibold">{t('Выберите занятие')}</h1>
      {scope && <p className="mt-1 text-center text-sm text-muted-foreground">{scope}</p>}
      {data?.lesson_title && (
        <p className="mt-1 break-words text-center text-sm">{data.lesson_title}</p>
      )}
      {lessonId && (
        <button
          type="button"
          className="mt-2 min-h-11 w-full underline"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ['lesson', lessonId] }).then(() =>
              navigate({
                to: '/learn/$lang/lessons/$lessonId',
                params: { lang, lessonId },
                search: {},
              }),
            )
          }
        >
          {t('К итогам материала')}
        </button>
      )}
      {isPending ? (
        <p role="status" className="mt-6">
          {t('Загрузка…')}
        </p>
      ) : isError ? (
        <div className="mt-6">
          <p className="text-destructive">{t('Не удалось загрузить счётчики')}</p>
          <button type="button" className="min-h-11 underline" onClick={() => void refetch()}>
            {t('Повторить')}
          </button>
        </div>
      ) : (
        data && (
          <>
            {!lessonId && data.daily && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {t('Сегодня сохранено: {{done}} из {{limit}} повторений.', {
                  done: data.daily.done_today,
                  limit: data.daily.limit,
                })}
              </p>
            )}
            {GROUPS.map((group) => (
              <section key={group.key} className="mt-7">
                <h2 className="font-semibold">
                  {t(
                    group.key === 'due' && lessonId ? 'Повторение лексики материала' : group.title,
                  )}
                </h2>
                <p className="mb-3 mt-1 text-sm text-muted-foreground">
                  {group.practice
                    ? t('Дополнительная практика — без изменения расписания.')
                    : countText(group.key)}
                </p>
                {!group.practice &&
                  data.session_sizes &&
                  data.session_sizes[group.key] < (data[group.key] ?? 0) && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      {t(
                        !lessonId &&
                          data.daily &&
                          data.daily.limit - data.daily.done_today <= data.session_sizes[group.key]
                          ? 'Размер занятия ограничен остатком дневного лимита.'
                          : 'Остальная лексика доступна в следующих занятиях.',
                      )}
                    </p>
                  )}
                <div className="grid gap-3">
                  {group.modes.map((m) => (
                    <button
                      key={m.mode}
                      type="button"
                      disabled={m.ai && !data.ai_enabled}
                      onClick={() =>
                        void navigate({
                          to: '/learn/$lang/review',
                          params: { lang },
                          search: {
                            mode: m.mode,
                            ...(lessonId ? { lessonId } : {}),
                            ...(itemKind ? { kind: itemKind } : {}),
                            ...(from ? { from } : {}),
                          },
                        })
                      }
                      className="min-h-16 rounded-xl border border-border bg-card p-4 text-left hover:bg-accent disabled:opacity-50"
                    >
                      <span className="block font-medium">{t(m.title)}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t(m.ai && !data.ai_enabled ? 'AI отключён' : m.hint)}
                      </span>
                      {group.practice && (
                        <span className="mt-2 block text-xs text-muted-foreground">
                          {countText(m.mode === 'translation' ? 'practice' : 'fill')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )
      )}
    </section>
  )
}
