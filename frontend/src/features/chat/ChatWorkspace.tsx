import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { chatsApi, type Generation } from '@/api/chats'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { chatDrafts, useChatStore } from './chatStore'
import { useChat } from './useChat'
import { ChatSidebar, ChatSidebarToggle } from './ChatSidebar'
import { useChatLayoutStore } from './chatLayoutStore'
import { ChatTranscript } from './ChatTranscript'
import { ChatComposer } from './ChatComposer'
import { ChatCitation } from './ChatCitation'

export function ChatWorkspace({
  lang,
  embedded = false,
  onReturn,
  externalList,
}: {
  lang: string
  embedded?: boolean
  onReturn?: () => void
  externalList?: { open: boolean; toggle: () => void }
}) {
  const t = useTranslation(),
    id = useChatStore((s) => s.activeId),
    uid = useChatStore((s) => s.userId),
    client = useQueryClient()
  const { history, detail, messages, capabilities, aiEnabled } = useChat(id)
  const sidebarOpen = useChatLayoutStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatLayoutStore((s) => s.setSidebarOpen)
  const [internalListOpen, setListOpen] = useState(false),
    [error, setError] = useState(false),
    [acting, setActing] = useState(false)
  const listOpen = externalList?.open ?? (embedded ? internalListOpen : sidebarOpen)
  const toggleList = () => {
    if (externalList) externalList.toggle()
    else if (embedded) setListOpen((v) => !v)
    else setSidebarOpen(!sidebarOpen)
  }
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true)
  const generations = detail?.generations ?? [],
    active = generations.find((g) => g.status === 'queued' || g.status === 'running')
  const mapped = messages.map((m) => ({
    id: m.id,
    role: m.role,
    state: m.state,
    createdAt: m.created_at,
    parts: [
      {
        type: 'text' as const,
        text:
          generations.find((g) => g.message_id === m.id && g.status === 'running')?.partial_text ||
          m.text,
      },
    ],
  }))
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [id, messages.length, active?.partial_text])
  async function command(generation: Generation, stop: boolean) {
    if (!id) return
    setActing(true)
    setError(false)
    const operationKey = `retry:${generation.id}`
    try {
      if (stop) await chatsApi.cancel(id, generation.id)
      else await chatsApi.retry(id, generation.id, chatDrafts.operation(operationKey).id)
      if (useChatStore.getState().userId !== uid) return
      chatDrafts.finishOperation(operationKey)
      await client.invalidateQueries({ queryKey: ['chats', uid] })
    } catch {
      setError(true)
    } finally {
      setActing(false)
    }
  }
  return (
    <section
      data-reader-panel
      aria-label={t('AI-чат')}
      className={`relative flex min-h-0 bg-background ${embedded ? 'min-w-0 flex-1 flex-col overflow-hidden' : 'mx-auto h-[calc(100dvh-8rem)] max-w-screen-2xl md:h-[calc(100dvh-4rem)]'}`}
    >
      {!embedded && listOpen && (
        <button
          aria-label={t('Закрыть список разговоров')}
          onClick={toggleList}
          className="absolute inset-0 z-30 bg-black/10 md:hidden"
        />
      )}
      {!embedded && (
        <aside
          className={`shrink-0 border-r border-border/60 bg-background ${listOpen ? 'w-[260px] max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl' : 'w-12'}`}
        >
          <ChatSidebar
            collapsed={!listOpen}
            onToggle={toggleList}
            onSelect={() => {
              if (window.innerWidth < 768) setSidebarOpen(false)
            }}
          />
        </aside>
      )}
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${!embedded && listOpen ? 'max-md:pl-12' : ''}`}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
          {embedded && (
            <div className={externalList ? '2xl:hidden' : undefined}>
              <ChatSidebarToggle open={listOpen} onToggle={toggleList} />
            </div>
          )}
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {detail?.title ?? t('Новый разговор')}
          </h2>
          {onReturn && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('Закрыть чат')}
              title={t('Закрыть чат')}
              onClick={onReturn}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </header>
        {embedded && listOpen && (
          <div
            className={`max-h-72 shrink-0 overflow-y-auto border-b ${externalList ? '2xl:hidden' : ''}`}
          >
            <ChatSidebar
              onSelect={() => (externalList ? externalList.toggle() : setListOpen(false))}
            />
          </div>
        )}
        <div
          ref={scroll}
          onScroll={() => {
            if (scroll.current)
              follow.current =
                scroll.current.scrollHeight -
                  scroll.current.scrollTop -
                  scroll.current.clientHeight <
                100
          }}
          // Keep absolute accessibility labels inside this scrollport's containing block.
          className="relative min-h-0 flex-1 overflow-y-auto p-4"
        >
          {!id && (
            <div className="mx-auto max-w-xl py-10 text-center">
              <h3 className="text-xl font-semibold">{t('Обсуждение начинается с вопроса')}</h3>
              <p className="mt-3 text-muted-foreground">
                {t('Нажмите плюс слева от абзаца, чтобы добавить цитату, и задайте вопрос.')}
              </p>
            </div>
          )}
          {id && history.isLoading && <p>{t('Загрузка…')}</p>}
          {history.isError && (
            <Button variant="outline" onClick={() => void history.refetch()}>
              {t('Повторить загрузку')}
            </Button>
          )}
          {history.hasNextPage && (
            <Button
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => {
                follow.current = false
                void history.fetchNextPage()
              }}
            >
              {t('Предыдущие сообщения')}
            </Button>
          )}
          <ChatTranscript
            conversationId={id ?? 'new'}
            messages={mapped}
            showComposer={false}
            renderText={(text) => (
              <div className="space-y-2 whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                <ReactMarkdown
                  skipHtml
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {text}
                </ReactMarkdown>
              </div>
            )}
            renderMessageMeta={(messageId) => {
              const message = messages.find((m) => m.id === messageId)
              return message ? (
                <>
                  <div className="mb-2 flex gap-2 text-xs text-muted-foreground">
                    <span>{t(message.role === 'assistant' ? 'Создано AI' : 'Вы')}</span>
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                  </div>
                  {message.citations.map((c) => (
                    <ChatCitation key={c.id} id={c.id} snapshot={c} onNavigate={onReturn} />
                  ))}
                </>
              ) : null
            }}
          />
          {generations.some((g) => g.context_truncated) && (
            <p className="my-3 text-sm text-muted-foreground">
              {t('Часть ранней истории не вошла в контекст ответа.')}
            </p>
          )}
          {generations
            .filter(
              (g) =>
                g.kind === 'reply' && ['failed', 'cancelled', 'interrupted'].includes(g.status),
            )
            .map((g) => (
              <div key={g.id} className="my-2 rounded border p-2 text-sm">
                <p>
                  {t(
                    g.status === 'cancelled'
                      ? 'Ответ остановлен'
                      : g.status === 'interrupted'
                        ? 'Ответ прерван'
                        : 'Не удалось получить ответ',
                  )}
                  {g.error_code === 'context_limit'
                    ? `: ${t('Контекст слишком большой. Сократите сообщение или уберите цитаты.')}`
                    : ''}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!aiEnabled || !!active || acting}
                  onClick={() => void command(g, false)}
                >
                  {t('Повторить ответ')}
                </Button>
              </div>
            ))}
        </div>
        {active && (
          <div
            className="flex items-center justify-between border-t px-3 py-2 text-sm"
            role="status"
          >
            <span>{t(active.status === 'queued' ? 'В очереди' : 'Формируем ответ…')}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => void command(active, true)}
            >
              {t('Остановить')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="px-3 text-sm">
            {t('Не удалось выполнить запрос. Попробуйте ещё раз.')}
          </p>
        )}
        {capabilities.isError && (
          <button onClick={() => void capabilities.refetch()}>{t('Повторить загрузку')}</button>
        )}
        <div data-chat-composer className="min-h-0 max-h-[55%] shrink-0 overflow-y-auto">
          <ChatComposer
            id={id}
            lang={lang}
            aiEnabled={aiEnabled}
            busy={!!active}
            capabilities={capabilities.data}
          />
        </div>
      </div>
    </section>
  )
}
