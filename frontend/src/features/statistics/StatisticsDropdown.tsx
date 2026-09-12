import { useI18n } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { Popover } from 'radix-ui'

import { statsApi, type StatsOverview } from '@/api/stats'
import { Button } from '@/components/ui/button'
import { learningLanguageFlag, learningLanguageLabel } from '@/lib/languages'

function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

/** Refresh at midnight even if the dropdown stays open, and on waking the tab. */
function useUtcDay() {
  const [day, setDay] = useState(utcDay)
  useEffect(() => {
    const refresh = () => setDay(utcDay())
    const now = new Date()
    const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const timer = window.setTimeout(refresh, Math.max(20, nextDay - now.getTime() + 20))
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [day])
  return day
}

/** Exact layered exports from Figma 83:3–7; no approximate replacement glyph. */
function StatsRing() {
  return (
    <span className="relative block size-7 shrink-0" aria-hidden="true">
      <img
        src="/assets/statistics/ring.svg"
        alt=""
        width={28}
        height={28}
        className="absolute inset-0 size-7"
      />
      {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => (
        <img
          key={corner}
          src={`/assets/statistics/ring-${corner}.svg`}
          alt=""
          width={14}
          height={14}
          className="absolute size-3.5"
          style={{
            [corner.startsWith('top') ? 'top' : 'bottom']: 0,
            [corner.endsWith('left') ? 'left' : 'right']: 0,
          }}
        />
      ))}
    </span>
  )
}

function MetricRow({ label, value }: { label: string; value: number }) {
  const { language } = useI18n()
  const formatNumber = new Intl.NumberFormat(language)
  return (
    <div className="flex items-baseline gap-2 border-b border-border py-3">
      <dd className="order-first min-w-5 text-[17px] leading-6 font-bold tabular-nums">
        {formatNumber.format(value)}
      </dd>
      <dt className="text-sm">{label}</dt>
    </div>
  )
}

function StatsContent({ data, onNavigate }: { data: StatsOverview; onNavigate: () => void }) {
  const { language, t } = useI18n()
  const formatNumber = new Intl.NumberFormat(language)
  return (
    <>
      <div className="py-6 text-center">
        <p
          aria-label={t('Новые слова сегодня')}
          className="text-[40px] leading-tight font-bold tracking-tight tabular-nums"
        >
          {formatNumber.format(data.new_items_today)}
        </p>
        <p className="mt-1 text-[15px] font-medium">{t('Новые слова')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.new_items_today === 0
            ? t('Добавьте первое слово сегодня')
            : t('Добавлено в изучение сегодня')}
        </p>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span aria-hidden="true">{learningLanguageFlag(data.language_code)}</span>
          <h3 className="text-sm font-semibold">
            {t('Сегодня ·')} {learningLanguageLabel(data.language_code, language)}
          </h3>
        </div>
        <span className="text-xs text-muted-foreground">{t('Сутки по UTC')}</span>
      </div>
      <dl className="mt-1">
        <MetricRow label={t('Прочитано слов')} value={data.tokens_read_today} />
        <MetricRow label={t('Новые слова')} value={data.new_items_today} />
        <MetricRow label={t('Выучено на повторении')} value={data.learned_items_today} />
      </dl>

      <h3 className="mt-5 text-sm font-semibold">{t('Всего')}</h3>
      <dl className="mt-1">
        <MetricRow label={t('В изучении')} value={data.tracked_items_count} />
        <MetricRow label={t('Известные слова')} value={data.known_items_count} />
      </dl>

      <div className="mt-4 rounded-lg bg-muted px-3 py-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{t('Доступно к повторению')}</span>
          <strong className="tabular-nums">{formatNumber.format(data.due_reviews)}</strong>
        </div>
        {data.due_reviews > 0 ? (
          <Link
            to="/learn/$lang/review"
            params={{ lang: data.language_code }}
            search={{}}
            onClick={onNavigate}
            className="mt-2 flex items-center gap-1 rounded-sm text-sm text-[var(--vocab-translation-fg)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('Перейти к повторению')} <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('Пока нет карточек для повторения')}
          </p>
        )}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {t('В словарных показателях учитываются слова и фразы.')}
      </p>
      <details className="mt-2 text-xs leading-relaxed text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {t('Как считается чтение')}
        </summary>
        <p className="mt-1">
          {t(
            'Чтение учитывается при переходе к следующей странице или предложению. Одно вхождение слова считается один раз в сутки. Учёт ведётся с',
          )}{' '}
          {new Intl.DateTimeFormat(language, {
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }).format(new Date(data.reading_tracking_started_at))}
          .
        </p>
      </details>
    </>
  )
}

export function StatisticsDropdown({ lang }: { lang: string }) {
  const { language, t } = useI18n()
  const formatNumber = new Intl.NumberFormat(language)
  const [open, setOpen] = useState(false)
  const day = useUtcDay()
  const query = useQuery({
    queryKey: ['stats', lang, day],
    queryFn: () => statsApi.overview(lang),
    refetchInterval: open ? 60_000 : false,
  })
  const data = query.isError ? undefined : query.data

  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) void query.refetch()
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('Открыть статистику')}
          className="flex shrink-0 items-center gap-2 rounded-lg p-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:px-2"
        >
          <StatsRing />
          <span className="hidden font-semibold tabular-nums min-[390px]:inline">
            {data ? formatNumber.format(data.known_items_count) : '—'}
          </span>
          <ChevronDown
            className="hidden size-3.5 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          aria-label={t('Статистика')}
          className="z-[var(--z-popover)] max-h-[var(--radix-popover-content-available-height)] w-[400px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,0.1)] outline-none"
        >
          <div className="flex items-center gap-2">
            <StatsRing />
            <span className="text-base font-semibold tabular-nums">
              {data ? formatNumber.format(data.known_items_count) : '—'}
            </span>
            <span className="text-[15px]">{t('Известные слова')}</span>
            <Popover.Close asChild>
              <button
                type="button"
                aria-label={t('Закрыть статистику')}
                className="-mr-1 ml-auto rounded-md p-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-[18px]" aria-hidden="true" />
              </button>
            </Popover.Close>
          </div>
          {query.isError ? (
            <div role="alert" className="py-8 text-center">
              <p className="text-sm">{t('Не удалось загрузить статистику')}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  void query.refetch()
                }}
              >
                {t('Попробовать снова')}
              </Button>
            </div>
          ) : data ? (
            <StatsContent data={data} onNavigate={() => setOpen(false)} />
          ) : (
            <div role="status" className="space-y-4 py-8">
              <span className="sr-only">{t('Загрузка статистики')}</span>
              <div className="mx-auto h-14 w-20 animate-pulse rounded-lg bg-muted" />
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
