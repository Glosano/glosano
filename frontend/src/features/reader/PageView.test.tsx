import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
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
