import { intlLocale, type Translator, type UiLanguage } from '@/lib/i18n'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Сколько календарных дней назад был `date` относительно `today` (0 — сегодня). */
function daysAgo(date: Date, today: Date): number {
  return Math.round((startOfDay(today).getTime() - startOfDay(date).getTime()) / DAY_MS)
}

/** `YYYY-MM-DD` с сервера — календарный день пользователя, без сдвига часового пояса. */
function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1)
}

export function formatDayHeading(
  day: string,
  today: Date,
  language: UiLanguage,
  t: Translator,
): string {
  const date = parseDay(day)
  const ago = daysAgo(date, today)
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  }
  const dateText = new Intl.DateTimeFormat(intlLocale(language), dateOptions).format(date)
  let name: string
  if (ago === 0) name = t('Today')
  else if (ago === 1) name = t('Yesterday')
  else {
    const weekday = new Intl.DateTimeFormat(intlLocale(language), { weekday: 'long' }).format(date)
    name = weekday.charAt(0).toLocaleUpperCase(intlLocale(language)) + weekday.slice(1)
  }
  return `${name} · ${dateText}`
}

export function formatLastActivity(
  iso: string,
  today: Date,
  language: UiLanguage,
  t: Translator,
): string {
  const date = new Date(iso)
  const ago = daysAgo(date, today)
  const when =
    ago === 0
      ? t('today')
      : ago === 1
        ? t('yesterday')
        : new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric', month: 'short' }).format(
            date,
          )
  return t('Last studied: {{when}}', { when })
}
