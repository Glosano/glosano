import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PageView } from './PageView'
import type { Sentence } from '@/api/reader'

const sentence = (seg_id: string): Sentence => ({
  seg_id,
  index: 0,
  text: seg_id,
  normalized_text: seg_id,
  tokens: [{ t: seg_id, n: seg_id, i: 0 }],
})
it('exposes one keyboard button per visible paragraph anchored to its source sentence without quoting on hover', () => {
  const quote = vi.fn()
  render(
    <PageView
      page={{
        sentences: [
          { paragraphIndex: 0, sentence: sentence('first') },
          { paragraphIndex: 0, sentence: sentence('continued') },
          { paragraphIndex: 1, sentence: sentence('second') },
        ],
        fromOrdinal: 0,
        toOrdinal: 0,
        wordCount: 3,
      }}
      statuses={{}}
      phraseIndex={new Map()}
      dragRange={null}
      languageCode="en"
      onQuoteParagraph={quote}
    />,
  )
  const buttons = screen.getAllByRole('button', { name: 'Добавить абзац в чат' })
  expect(buttons).toHaveLength(2)
  fireEvent.mouseEnter(screen.getByText('continued'))
  expect(quote).not.toHaveBeenCalled()
  buttons[0]!.focus()
  expect(buttons[0]).toHaveFocus()
  fireEvent.click(buttons[0]!)
  fireEvent.click(buttons[1]!)
  expect(quote.mock.calls).toEqual([['first'], ['second']])
})

const followedPage = {
  sentences: [{ paragraphIndex: 0, sentence: sentence('playing') }],
  fromOrdinal: 0,
  toOrdinal: 0,
  wordCount: 1,
}

const originalScrollIntoView = Element.prototype.scrollIntoView

function renderFollowing() {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  return {
    scroll,
    view: render(
      <PageView
        page={followedPage}
        statuses={{}}
        phraseIndex={new Map()}
        dragRange={null}
        languageCode="en"
        activeSegment="playing"
        followPlayback
      />,
    ),
  }
}

function placeActive(top: number, bottom: number) {
  const target = document.querySelector<HTMLElement>('[aria-current="true"]')!
  target.getBoundingClientRect = () => ({ top, bottom }) as DOMRect
  return target
}

afterEach(() => {
  document.querySelector('[data-video-pinned]')?.remove()
  Element.prototype.scrollIntoView = originalScrollIntoView
})

it('scrolls the playing sentence out from under the pinned video', () => {
  const player = document.createElement('section')
  player.setAttribute('data-video-pinned', '')
  player.getBoundingClientRect = () => ({ top: 0, bottom: 250 }) as DOMRect
  document.body.append(player)
  const { scroll, view } = renderFollowing()
  const target = placeActive(150, 190)
  target.style.scrollMarginTop = ''
  scroll.mockClear()
  view.rerender(
    <PageView
      page={followedPage}
      statuses={{}}
      phraseIndex={new Map()}
      dragRange={null}
      languageCode="en"
      activeSegment={null}
      followPlayback
    />,
  )
  view.rerender(
    <PageView
      page={followedPage}
      statuses={{}}
      phraseIndex={new Map()}
      dragRange={null}
      languageCode="en"
      activeSegment="playing"
      followPlayback
    />,
  )
  expect(target.style.scrollMarginTop).toBe('266px')
  expect(scroll).toHaveBeenCalled()
})

it('keeps the old threshold when no video is pinned', () => {
  const { scroll, view } = renderFollowing()
  const target = placeActive(150, 190)
  scroll.mockClear()
  view.rerender(
    <PageView
      page={followedPage}
      statuses={{}}
      phraseIndex={new Map()}
      dragRange={null}
      languageCode="en"
      activeSegment={null}
      followPlayback
    />,
  )
  view.rerender(
    <PageView
      page={followedPage}
      statuses={{}}
      phraseIndex={new Map()}
      dragRange={null}
      languageCode="en"
      activeSegment="playing"
      followPlayback
    />,
  )
  expect(target.style.scrollMarginTop).toBe('')
  expect(scroll).not.toHaveBeenCalled()
})

it('clears the scroll margin once the video is unpinned', () => {
  const player = document.createElement('section')
  player.setAttribute('data-video-pinned', '')
  player.getBoundingClientRect = () => ({ top: 0, bottom: 250 }) as DOMRect
  document.body.append(player)
  const { scroll, view } = renderFollowing()
  const target = placeActive(150, 190)
  const rerenderWith = (activeSegment: string | null) =>
    view.rerender(
      <PageView
        page={followedPage}
        statuses={{}}
        phraseIndex={new Map()}
        dragRange={null}
        languageCode="en"
        activeSegment={activeSegment}
        followPlayback
      />,
    )
  rerenderWith(null)
  rerenderWith('playing')
  expect(target.style.scrollMarginTop).toBe('266px')

  player.remove()
  placeActive(20, 60)
  scroll.mockClear()
  rerenderWith(null)
  rerenderWith('playing')
  expect(target.style.scrollMarginTop).toBe('')
  expect(scroll).toHaveBeenCalled()
})
