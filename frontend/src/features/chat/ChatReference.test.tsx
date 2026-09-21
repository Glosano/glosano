import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { chatsApi } from '@/api/chats'
import { setUiLanguage } from '@/lib/i18n'
import { chatDrafts } from './chatStore'
import { ChatReference } from './ChatReference'
it('restores a readable exercise and exact old attempt rather than displaying internal identifiers', async () => {
  setUiLanguage('en')
  chatDrafts.setUser('user')
  vi.spyOn(chatsApi, 'exercise').mockResolvedValue({
    id: 'ex',
    conversation_id: 'chat',
    message_id: 'm',
    kind: 'gap',
    prompt: 'Eu {{gap}} aqui.',
  })
  const attempt = {
    id: 'exact-attempt',
    exercise_id: 'ex',
    conversation_id: 'chat',
    operation_id: 'op',
    answer: 'estou',
    status: 'complete' as const,
    correct: true,
    feedback: 'Good.',
    created_at: '2026-09-18T00:00:00Z',
  }
  vi.spyOn(chatsApi, 'attempts').mockImplementation(async (_c, _e, offset) => ({
    items: offset
      ? [attempt]
      : Array.from({ length: 50 }, (_, i) => ({
          ...attempt,
          id: `recent${i}`,
          answer: 'Other answer',
        })),
  }))
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChatReference conversationId="chat" exerciseId="ex" attemptId="exact-attempt" />
    </QueryClientProvider>,
  )
  await screen.findByText('estou')
  expect(screen.getByText('Eu _____ aqui.')).toBeInTheDocument()
  expect(screen.getByText('Correct')).toBeInTheDocument()
  expect(screen.queryByText('exact-attempt')).not.toBeInTheDocument()
})
