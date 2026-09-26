import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('@/test/routerLinkMock')).MockLink,
  useParams: () => ({ lang: 'pt' }),
}))

import type { LessonHistoryResponse, LessonSummary } from '@/api/lessons'
import { setUiLanguage } from '@/lib/i18n'

import { LibraryView } from './LibraryView'
import { useLibraryStore } from './libraryStore'

function lesson(id: string, extra: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id,
    title: `Title ${id}`,
    language_code: 'pt',
    word_count: 10,
    visibility: 'private',
    status: 'ready',
    created_at: '2026-09-26T10:00:00Z',
    read_percent: 0,
    new_words_remaining: 10,
    can_manage: false,
    ...extra,
  }
}

type Routes = {
  continue: LessonSummary[]
  history: (before: string | null) => LessonHistoryResponse
}

function stubApi(routes: Routes) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const parsed = new URL(url, 'http://test')
    const body = parsed.pathname.endsWith('/continue')
      ? { items: routes.continue }
      : routes.history(parsed.searchParams.get('before'))
    return new Response(JSON.stringify(body))
  })
  return calls
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LibraryView lang="pt" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 26, 12))
  useLibraryStore.getState().reset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  act(() => setUiLanguage('ru'))
})

describe('LibraryView', () => {
  it('shows continue learning above day sections in server order', async () => {
    stubApi({
      continue: [lesson('C1', { last_activity_at: '2026-09-26T09:00:00Z' })],
      history: () => ({
        days: [
          { date: '2026-09-26', total: 1, items: [lesson('D1')] },
          { date: '2026-09-24', total: 1, items: [lesson('D2')] },
        ],
        next_before: null,
      }),
    })
    renderView()
    const continueSection = await screen.findByRole('region', { name: 'Продолжить изучение' })
    expect(within(continueSection).getByText('Title C1')).toBeInTheDocument()
    const headings = (await screen.findAllByRole('heading', { level: 3, name: /·/ })).map(
      (h) => h.textContent,
    )
    expect(headings).toEqual(['Сегодня · 26 сентября', 'Четверг · 24 сентября'])
    // Card titles sit one level below the day headings.
    expect(screen.getByRole('heading', { level: 4, name: 'Title D1' })).toBeInTheDocument()
  })

  it('hides continue learning when nothing is in progress', async () => {
    stubApi({
      continue: [],
      history: () => ({
        days: [{ date: '2026-09-26', total: 1, items: [lesson('D1')] }],
        next_before: null,
      }),
    })
    renderView()
    expect(await screen.findByText('Title D1')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Продолжить изучение' })).not.toBeInTheDocument()
  })

  it('loads earlier days on demand', async () => {
    const calls = stubApi({
      continue: [],
      history: (before) =>
        before === null
          ? {
              days: [{ date: '2026-09-26', total: 1, items: [lesson('D1')] }],
              next_before: '2026-09-26',
            }
          : {
              days: [{ date: '2026-09-20', total: 1, items: [lesson('D9')] }],
              next_before: null,
            },
    })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    expect(await screen.findByText('Title D9')).toBeInTheDocument()
    expect(calls.some((url) => url.includes('before=2026-09-26'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('marks a day that has more materials than returned', async () => {
    stubApi({
      continue: [],
      history: () => ({
        days: [{ date: '2026-09-26', total: 103, items: [lesson('D1')] }],
        next_before: null,
      }),
    })
    renderView()
    expect(await screen.findByText('ещё 102')).toBeInTheDocument()
  })

  it('shows the empty library state when there is nothing at all', async () => {
    stubApi({ continue: [], history: () => ({ days: [], next_before: null }) })
    renderView()
    expect(await screen.findByText('У вас пока нет уроков')).toBeInTheDocument()
  })

  it('shows nothing-found when a search matches nothing', async () => {
    useLibraryStore.getState().setSearch('zzz')
    stubApi({ continue: [], history: () => ({ days: [], next_before: null }) })
    renderView()
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.queryByText('У вас пока нет уроков')).not.toBeInTheDocument()
  })

  it('sends the browser timezone with the history request', async () => {
    const calls = stubApi({ continue: [], history: () => ({ days: [], next_before: null }) })
    renderView()
    await screen.findByText('У вас пока нет уроков')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(calls.some((url) => url.includes(`tz=${encodeURIComponent(tz)}`))).toBe(true)
  })

  it('auto-loads on intersection and keeps a single stable observer across renders', async () => {
    class FakeIntersectionObserver {
      static instances: FakeIntersectionObserver[] = []
      observeCalls = 0
      callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        FakeIntersectionObserver.instances.push(this)
      }
      observe() {
        this.observeCalls += 1
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

    const calls = stubApi({
      continue: [],
      history: (before) =>
        before === null
          ? {
              days: [{ date: '2026-09-26', total: 1, items: [lesson('D1')] }],
              next_before: '2026-09-26',
            }
          : {
              days: [{ date: '2026-09-20', total: 1, items: [lesson('D9')] }],
              next_before: null,
            },
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // A fresh element on every call, not a reused reference — reusing the same
    // element object would let React bail out via identity and never actually
    // re-invoke LibraryView's render, hiding the bug this test targets.
    const renderTree = () =>
      render(
        <QueryClientProvider client={client}>
          <LibraryView lang="pt" />
        </QueryClientProvider>,
      )
    const { rerender } = renderTree()

    await screen.findByText('Title D1')
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    const observer = FakeIntersectionObserver.instances[0]
    if (!observer) throw new Error('observer was not created')
    expect(observer.observeCalls).toBe(1)

    // Re-render the parent without any state change — must not tear down and
    // recreate the observer (that would re-fire the callback on an
    // already-visible sentinel).
    rerender(
      <QueryClientProvider client={client}>
        <LibraryView lang="pt" />
      </QueryClientProvider>,
    )
    await screen.findByText('Title D1')
    expect(FakeIntersectionObserver.instances).toHaveLength(1)

    act(() => {
      observer.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      )
    })

    expect(await screen.findByText('Title D9')).toBeInTheDocument()
    expect(calls.filter((url) => url.includes('before=2026-09-26'))).toHaveLength(1)
  })

  it('does not auto-retry a failed next page on intersection', async () => {
    class FakeIntersectionObserver {
      static instances: FakeIntersectionObserver[] = []
      disconnected = false
      callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        FakeIntersectionObserver.instances.push(this)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.disconnected = true
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    // A disconnected observer never fires in a browser; only live ones do.
    const intersect = () => {
      act(() => {
        for (const observer of FakeIntersectionObserver.instances) {
          if (observer.disconnected) continue
          observer.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            observer as unknown as IntersectionObserver,
          )
        }
      })
    }

    const nextPageCalls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      const parsed = new URL(url, 'http://test')
      if (parsed.pathname.endsWith('/continue')) {
        return new Response(JSON.stringify({ items: [] }))
      }
      if (parsed.searchParams.get('before') === null) {
        return new Response(
          JSON.stringify({
            days: [{ date: '2026-09-26', total: 1, items: [lesson('D1')] }],
            next_before: '2026-09-26',
          }),
        )
      }
      nextPageCalls.push(url)
      return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 })
    })
    renderView()

    await screen.findByText('Title D1')
    intersect()
    expect(await screen.findByText('Ошибка загрузки уроков')).toBeInTheDocument()
    expect(nextPageCalls).toHaveLength(1)

    // The sentinel is still on screen: an intersection must not hammer the
    // failing endpoint again; the button stays for a manual retry.
    intersect()
    await act(async () => {
      await Promise.resolve()
    })
    expect(nextPageCalls).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await vi.waitFor(() => {
      expect(nextPageCalls).toHaveLength(2)
    })
  })
})
