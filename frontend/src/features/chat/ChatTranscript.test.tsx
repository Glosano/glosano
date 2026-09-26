import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setUiLanguage } from '@/lib/i18n'

import { ChatTranscript } from './ChatTranscript'
import type { ChatTranscriptMessage } from './transcript'

const message = (
  id: string,
  role: ChatTranscriptMessage['role'],
  text: string,
  state: ChatTranscriptMessage['state'] = 'complete',
): ChatTranscriptMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  state,
})

beforeEach(() => {
  setUiLanguage('en')
})

afterEach(() => {
  act(() => setUiLanguage('ru'))
})

describe('ChatTranscript', () => {
  it('renders external messages and replaces an incremental assistant reply in place', () => {
    const { rerender } = render(
      <ChatTranscript
        conversationId="conversation-a"
        messages={[
          message('message-user-1', 'user', 'Explain this sentence'),
          message('message-assistant-1', 'assistant', 'It means', 'pending'),
        ]}
      />,
    )

    expect(screen.getByText('Explain this sentence')).toBeInTheDocument()
    expect(screen.getByText('It means')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)

    rerender(
      <ChatTranscript
        conversationId="conversation-a"
        messages={[
          message('message-user-1', 'user', 'Explain this sentence'),
          message('message-assistant-1', 'assistant', 'It means hello.', 'complete'),
        ]}
      />,
    )

    expect(screen.queryByText('It means')).not.toBeInTheDocument()
    expect(screen.getByText('It means hello.')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('replaces history on a conversation switch and sends through the displayed conversation', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <ChatTranscript
        conversationId="conversation-a"
        messages={[message('message-a', 'assistant', 'History A')]}
        onSend={onSend}
        onCancel={onCancel}
      />,
    )

    rerender(
      <ChatTranscript
        conversationId="conversation-b"
        messages={[message('message-b', 'assistant', 'History B')]}
        onSend={onSend}
        onCancel={onCancel}
      />,
    )

    expect(screen.queryByText('History A')).not.toBeInTheDocument()
    expect(screen.getByText('History B')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Question for B' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend).toHaveBeenCalledWith('conversation-b', 'Question for B')

    rerender(
      <ChatTranscript
        conversationId="conversation-b"
        messages={[message('message-b', 'assistant', 'History B', 'pending')]}
        onSend={onSend}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
    expect(onCancel).toHaveBeenCalledWith('conversation-b')
  })

  it('renders an inline exercise with stable domain identifiers', () => {
    const exerciseMessage: ChatTranscriptMessage = {
      id: 'message-exercise-7',
      role: 'assistant',
      state: 'complete',
      parts: [
        { type: 'text', text: 'Try this:' },
        {
          type: 'exercise',
          exerciseId: 'exercise-42',
          exerciseType: 'multiple_choice',
          prompt: 'Choose the translation',
        },
      ],
    }

    render(
      <ChatTranscript
        conversationId="conversation-exercises"
        messages={[exerciseMessage]}
        renderExercise={({ conversationId, messageId, exercise }) => (
          <section aria-label={`Exercise ${exercise.exerciseId}`}>
            {conversationId}:{messageId}:{exercise.prompt}
          </section>
        )}
      />,
    )

    const rendered = screen.getByRole('region', { name: 'Exercise exercise-42' })
    expect(rendered).toHaveTextContent(
      'conversation-exercises:message-exercise-7:Choose the translation',
    )
  })

  it('updates transcript status, exercise and composer strings when the UI locale changes', () => {
    const exerciseMessage: ChatTranscriptMessage = {
      id: 'message-exercise-localized',
      role: 'assistant',
      state: 'complete',
      parts: [
        {
          type: 'exercise',
          exerciseId: 'exercise-localized',
          exerciseType: 'multiple_choice',
          prompt: 'Immutable exercise prompt',
        },
      ],
    }
    render(
      <ChatTranscript
        conversationId="conversation-localized"
        messages={[
          exerciseMessage,
          message('message-pending-localized', 'assistant', 'Working', 'pending'),
          message('message-error-localized', 'assistant', 'Could not finish', 'error'),
          message('message-cancelled-localized', 'assistant', 'Stopped response', 'cancelled'),
        ]}
        onSend={() => undefined}
        onCancel={() => undefined}
      />,
    )

    expect(screen.getByRole('log', { name: 'Chat transcript' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Exercise exercise-localized' })).toHaveTextContent(
      'Immutable exercise prompt',
    )
    expect(screen.getByLabelText('Response pending')).toHaveTextContent('Generating…')
    expect(screen.getByRole('alert')).toHaveTextContent('Response failed')
    expect(screen.getByLabelText('Response cancelled')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveTextContent('Send')
    expect(screen.getByRole('button', { name: 'Stop response' })).toHaveTextContent('Stop')

    act(() => setUiLanguage('ru'))

    expect(screen.getByRole('log', { name: 'История чата' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Упражнение exercise-localized' })).toHaveTextContent(
      'Immutable exercise prompt',
    )
    expect(screen.getByLabelText('Ответ формируется')).toHaveTextContent('Формируем ответ…')
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось получить ответ')
    expect(screen.getByLabelText('Ответ остановлен')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Сообщение' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toHaveTextContent(
      'Отправить',
    )
    expect(screen.getByRole('button', { name: 'Остановить ответ' })).toHaveTextContent('Остановить')
  })

  it('restores exactly the supplied history after unmount and replacement', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const history = [
      message('message-user-restore', 'user', 'Persisted question'),
      message('message-assistant-restore', 'assistant', 'Persisted answer'),
    ]
    const first = render(
      <ChatTranscript conversationId="conversation-restore" messages={history} onSend={onSend} />,
    )

    first.unmount()
    render(
      <ChatTranscript
        conversationId="conversation-restore"
        messages={[...history]}
        onSend={onSend}
      />,
    )

    const transcript = screen.getByRole('log', { name: 'Chat transcript' })
    expect(within(transcript).getAllByRole('article')).toHaveLength(2)
    expect(within(transcript).getAllByText('Persisted question')).toHaveLength(1)
    expect(within(transcript).getAllByText('Persisted answer')).toHaveLength(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('exposes pending, error and cancelled states and disables a read-only composer', () => {
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(
      <ChatTranscript
        conversationId="conversation-readonly"
        readOnly
        messages={[
          message('message-pending', 'assistant', 'Working', 'pending'),
          {
            ...message('message-error', 'assistant', 'Could not finish', 'error'),
            error: 'Provider unavailable',
          },
          message('message-cancelled', 'assistant', 'Stopped response', 'cancelled'),
        ]}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByLabelText('Response pending')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable')
    expect(screen.getByLabelText('Response cancelled')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Stop response' })).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('lays out user messages as bubbles on the right and replies full width, with actions below', () => {
    render(
      <ChatTranscript
        conversationId="conversation-layout"
        messages={[
          message('message-user', 'user', 'Explain this sentence'),
          message('message-assistant', 'assistant', 'It means hello.'),
        ]}
        renderMessageActions={(id) => <button type="button">{`Actions ${id}`}</button>}
      />,
    )

    const [user, assistant] = screen.getAllByRole('article')
    expect(user).toHaveAttribute('data-message-role', 'user')
    expect(user!.className).toContain('rounded-3xl')
    expect(user!.parentElement!.className).toContain('items-end')
    expect(assistant).toHaveAttribute('data-message-role', 'assistant')
    expect(assistant!.className).not.toContain('border')
    const userActions = screen.getByRole('button', { name: 'Actions message-user' })
    expect(user).not.toContainElement(userActions)
    expect(user!.parentElement).toContainElement(userActions)
  })
})
