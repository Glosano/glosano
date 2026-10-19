import { describe, expect, it } from 'vitest'

import { translate } from '@/lib/i18n'

import { formatDayHeading, formatLastActivity } from './libraryDates'

// 2026-09-26 — суббота.
const today = new Date(2026, 8, 26, 15, 0)
const ru = (key: string, params?: Record<string, string | number>) => translate(key, params, 'ru')
const en = (key: string, params?: Record<string, string | number>) => translate(key, params, 'en')

describe('formatDayHeading', () => {
  it('names today and yesterday', () => {
    expect(formatDayHeading('2026-09-26', today, 'ru', ru)).toBe('Сегодня · 26 сентября')
    expect(formatDayHeading('2026-09-25', today, 'ru', ru)).toBe('Вчера · 25 сентября')
    expect(formatDayHeading('2026-09-26', today, 'en', en)).toBe('Today · September 26')
    expect(formatDayHeading('2026-09-25', today, 'en', en)).toBe('Yesterday · September 25')
  })

  it('uses a capitalised weekday for older days', () => {
    expect(formatDayHeading('2026-09-24', today, 'ru', ru)).toBe('Четверг · 24 сентября')
    expect(formatDayHeading('2026-09-24', today, 'en', en)).toBe('Thursday · September 24')
  })

  it('adds the year for previous years', () => {
    expect(formatDayHeading('2025-12-12', today, 'ru', ru)).toBe('Пятница · 12 декабря 2025 г.')
    expect(formatDayHeading('2025-12-12', today, 'en', en)).toBe('Friday · December 12, 2025')
  })
})

describe('formatLastActivity', () => {
  it('says today, yesterday or a short date in local time', () => {
    expect(formatLastActivity(new Date(2026, 8, 26, 9).toISOString(), today, 'ru', ru)).toBe(
      'Последнее занятие: сегодня',
    )
    expect(formatLastActivity(new Date(2026, 8, 25, 23).toISOString(), today, 'en', en)).toBe(
      'Last studied: yesterday',
    )
    expect(formatLastActivity(new Date(2026, 8, 24, 9).toISOString(), today, 'ru', ru)).toBe(
      'Последнее занятие: 24 сент.',
    )
    expect(formatLastActivity(new Date(2026, 8, 24, 9).toISOString(), today, 'en', en)).toBe(
      'Last studied: Sep 24',
    )
  })

  it('formats the short date with European Portuguese for pt', () => {
    const date = new Date(2026, 8, 24, 9)
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
    const european = new Intl.DateTimeFormat('pt-PT', options).format(date)
    const brazilian = new Intl.DateTimeFormat('pt', options).format(date)
    const pt = (key: string, params?: Record<string, string | number>) =>
      translate(key, params, 'pt')
    expect(european).not.toBe(brazilian)
    expect(formatLastActivity(date.toISOString(), today, 'pt', pt)).toContain(european)
    expect(formatLastActivity(date.toISOString(), today, 'pt', pt)).not.toContain(brazilian)
  })
})
