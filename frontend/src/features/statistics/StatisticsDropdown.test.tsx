import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params: { lang: string } }) => (
    <a href={`/learn/${params.lang}/review`}>{children}</a>
  ),
}))

import { setUiLanguage } from '@/lib/i18n'

import { StatisticsDropdown } from './StatisticsDropdown'

const TODAY = new Date().toISOString().slice(0, 10)
const DATA = {
  language_code: 'pt',
  date: TODAY,
  timezone: 'UTC',
  known_items_count: 4339,
  tracked_items_count: 82,
  ignored_items_count: 99,
  tokens_read_today: 1430,
  new_items_today: 12,
  learned_items_today: 3,
  reviews_completed_today: 25,
  due_reviews: 7,
  reading_tracking_started_at: '2026-09-10T12:00:00Z',
}

function respond(data = DATA) {
  return new Response(JSON.stringify(data), { status: 200 })
}

function setup(lang = 'pt') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (code: string) => (
    <QueryClientProvider client={qc}>
      <StatisticsDropdown lang={code} />
    </QueryClientProvider>
  )
  const result = render(wrap(lang))
  return { ...result, qc, setLanguage: (code: string) => result.rerender(wrap(code)) }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(respond())),
  )
})
afterEach(() => {
  act(() => setUiLanguage('ru'))
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('StatisticsDropdown', () => {
  it('switches the open panel, accessible labels and number/date formatting live', async () => {
    setUiLanguage('en')
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Open statistics' }))
    const panel = await screen.findByRole('dialog', { name: 'Statistics' })
    expect(await within(panel).findByText('1,430')).toBeInTheDocument()
    expect(within(panel).getByText('Today · Portuguese')).toBeInTheDocument()
    expect(within(panel).getByText(/September 10/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Start reviewing' })).toHaveAttribute('href', '/learn/pt/review')
    act(() => setUiLanguage('ru'))
    expect(screen.getByRole('dialog', { name: 'Статистика' })).toBeInTheDocument()
    expect(within(panel).getByText(/1\s430/)).toBeInTheDocument()
    expect(within(panel).getByText('Сегодня · Португальский')).toBeInTheDocument()
    expect(within(panel).getByText(/10 сентября/)).toBeInTheDocument()
  })

  it('opens real today counts and the current-language review link without excluded UI', async () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Открыть статистику' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'Статистика' })
    await within(panel).findByText(/1\s430/)
    expect(within(panel).getAllByText('Новые слова')).toHaveLength(2)
    expect(within(panel).getByLabelText('Новые слова сегодня')).toHaveTextContent('12')
    expect(within(panel).getByText('Выучено на повторении')).toBeInTheDocument()
    expect(within(panel).getByText('Сутки по UTC')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /Перейти к повторению/ })).toHaveAttribute(
      'href',
      '/learn/pt/review',
    )
    expect(panel).not.toHaveTextContent(/LingQ|монет|Прослуш|непрерывного|Смотреть всю|30 дней/)
    expect(fetch).toHaveBeenCalledWith('/api/stats/overview?lang=pt', expect.anything())
  })

  it('uses the shared localized name for simplified Chinese', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respond({ ...DATA, language_code: 'zh-Hans' }),
    )
    setUiLanguage('en')
    setup('zh-Hans')

    fireEvent.click(screen.getByRole('button', { name: 'Open statistics' }))

    const panel = await screen.findByRole('dialog', { name: 'Statistics' })
    expect(await within(panel).findByText('Today · Chinese (Simplified)')).toBeInTheDocument()
    expect(within(panel).getByText('🇨🇳')).toHaveAttribute('aria-hidden', 'true')
  })

  it('closes with Escape and returns keyboard focus to its trigger', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: 'Открыть статистику' })
    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes by cross and outside click', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    await user.click(screen.getByRole('button', { name: 'Закрыть статистику' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows loading rather than zero counts while the request is pending', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка статистики')
    expect(screen.queryByLabelText('Новые слова сегодня')).not.toBeInTheDocument()
  })

  it('shows an error and retries without substituting fake zero activity', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить статистику')
    expect(screen.queryByLabelText('Новые слова сегодня')).not.toBeInTheDocument()
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(respond()))
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByLabelText('Новые слова сегодня')).toHaveTextContent('12')
  })

  it('does not show the preceding language data while the next language loads', async () => {
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    expect(await screen.findByLabelText('Новые слова сегодня')).toHaveTextContent('12')
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    view.setLanguage('ru')
    expect(screen.queryByLabelText('Новые слова сегодня')).not.toBeInTheDocument()
    await act(async () => resolve(respond({ ...DATA, language_code: 'ru', new_items_today: 2 })))
    expect(await screen.findByLabelText('Новые слова сегодня')).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /Перейти к повторению/ })).toHaveAttribute(
      'href',
      '/learn/ru/review',
    )
  })

  it('renders an honest empty state without congratulating on fictional goals', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        respond({
          ...DATA,
          known_items_count: 0,
          tracked_items_count: 0,
          tokens_read_today: 0,
          new_items_today: 0,
          learned_items_today: 0,
          reviews_completed_today: 0,
          due_reviews: 0,
        }),
      ),
    )
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    expect(await screen.findByLabelText('Новые слова сегодня')).toHaveTextContent('0')
    expect(screen.getByText('Добавьте первое слово сегодня')).toBeInTheDocument()
    expect(screen.getByText('Пока нет карточек для повторения')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Перейти к повторению/ })).not.toBeInTheDocument()
  })
  it('refreshes today counts when UTC midnight passes with the panel open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T23:59:59Z'))
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        respond({
          ...DATA,
          date: new Date().toISOString().slice(0, 10),
          new_items_today: new Date().getUTCDate() === 10 ? 12 : 0,
        }),
      ),
    )
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть статистику' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByLabelText('Новые слова сегодня')).toHaveTextContent('12')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByLabelText('Новые слова сегодня')).toHaveTextContent('0')
  })
})
