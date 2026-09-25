import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ChatMarkdown } from './ChatMarkdown'

it('keeps footnote navigation within each message in the current tab', () => {
  render(
    <>
      <ChatMarkdown text={'First[^1]\n\n[^1]: First note'} />
      <ChatMarkdown text={'Second[^1]\n\n[^1]: Second note'} />
    </>,
  )

  for (const link of screen.getAllByRole('link')) {
    expect(link).not.toHaveAttribute('target', '_blank')
    const target = document.getElementById(link.getAttribute('href')!.slice(1))
    expect(target).not.toBeNull()
    expect(target?.closest('.chat-markdown')).toBe(link.closest('.chat-markdown'))
    const description = link.getAttribute('aria-describedby')
    if (description) {
      expect(document.getElementById(description)?.closest('.chat-markdown')).toBe(
        link.closest('.chat-markdown'),
      )
    }
  }
})
