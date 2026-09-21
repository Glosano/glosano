import { useId, useState, type ComponentProps } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, PanelLeft, Pencil, SquarePen, Trash2 } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { chatsApi, type Conversation } from '@/api/chats'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { chatDrafts, useChatStore } from './chatStore'
import { useChatList } from './useChat'

function SidebarButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label={label} {...props}>
            {children}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={10}
            className="z-[var(--z-popover)] rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-lg"
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export function ChatSidebarToggle({
  open,
  onToggle,
  controls,
}: {
  open: boolean
  onToggle: () => void
  controls?: string
}) {
  const t = useTranslation()
  return (
    <SidebarButton
      label={t(open ? 'Закрыть боковую панель' : 'Открыть боковую панель')}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <PanelLeft className="size-[18px]" strokeWidth={1.7} />
    </SidebarButton>
  )
}

export function ChatSidebar({
  onSelect,
  collapsed = false,
  onToggle,
}: {
  onSelect?: () => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  const t = useTranslation(),
    query = useChatList(),
    client = useQueryClient()
  const uid = useChatStore((s) => s.userId),
    active = useChatStore((s) => s.activeId)
  const [editing, setEditing] = useState<Conversation | null>(null),
    [deleting, setDeleting] = useState<Conversation | null>(null)
  const [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false)
  const listId = useId()
  async function change(remove: boolean) {
    const target = remove ? deleting : editing
    if (!target) return
    setBusy(true)
    setError(false)
    try {
      if (remove) {
        await chatsApi.delete(target.id)
        if (useChatStore.getState().userId === uid) chatDrafts.remove(target.id)
      } else await chatsApi.rename(target.id, title.trim())
      if (useChatStore.getState().userId !== uid) return
      setDeleting(null)
      setEditing(null)
      await client.invalidateQueries({ queryKey: ['chats', uid] })
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <nav
      aria-label={t('Разговоры')}
      className="flex h-full min-h-0 flex-col bg-muted/25 text-foreground"
    >
      <div className={cn('flex shrink-0 items-center gap-1 p-1.5', collapsed && 'flex-col gap-3')}>
        {onToggle && <ChatSidebarToggle open={!collapsed} onToggle={onToggle} controls={listId} />}
        {!collapsed && (
          <h2 className="flex-1 px-1.5 text-xs font-medium text-muted-foreground">{t('Чаты')}</h2>
        )}
        <SidebarButton
          label={t('Новый разговор')}
          onClick={() => {
            chatDrafts.select(null)
            onSelect?.()
          }}
        >
          <SquarePen className="size-[18px]" strokeWidth={1.7} />
        </SidebarButton>
      </div>
      {!collapsed && (
        <div
          id={listId}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3 [scrollbar-width:thin]"
        >
          {query.isLoading && (
            <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
              {t('Загрузка…')}
            </p>
          )}
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('Повторить загрузку')}
            </Button>
          )}
          {query.data?.pages
            .flatMap((p) => p.items)
            .map((c) => (
              <div
                key={c.id}
                className={cn(
                  'group relative flex h-9 items-center rounded-lg hover:bg-accent/70 focus-within:bg-accent/70',
                  active === c.id && 'bg-accent',
                )}
              >
                <button
                  className="h-full min-w-0 flex-1 truncate rounded-lg py-2 pl-2 pr-9 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  title={c.title}
                  aria-current={active === c.id ? 'true' : undefined}
                  onClick={() => {
                    chatDrafts.select(c.id)
                    onSelect?.()
                  }}
                >
                  {c.title}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Действия с разговором: {{title}}', { title: c.title })}
                      className={cn(
                        'absolute right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
                        active === c.id && 'opacity-100',
                      )}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="right"
                    className="z-[var(--z-popover)] min-w-44"
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(c)
                        setTitle(c.title)
                        setError(false)
                      }}
                    >
                      <Pencil />
                      {t('Переименовать')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setDeleting(c)
                        setError(false)
                      }}
                    >
                      <Trash2 />
                      {t('Удалить')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          {query.data?.pages[0]?.items.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t('Разговор появится после первого сообщения.')}
            </p>
          )}
          {query.hasNextPage && (
            <Button
              variant="ghost"
              className="mt-2 w-full text-muted-foreground"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('Ещё разговоры')}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={!!editing || !!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditing(null)
            setDeleting(null)
          }
        }}
      >
        <DialogContent className="z-[var(--z-popover)]">
          <DialogTitle>{t(deleting ? 'Удалить разговор?' : 'Переименовать разговор')}</DialogTitle>
          <DialogDescription>
            {deleting
              ? t('История, упражнения и попытки этого разговора будут удалены.')
              : t('Название разговора')}
          </DialogDescription>
          {editing && (
            <input
              aria-label={t('Название разговора')}
              className="rounded border p-2"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
          {error && <p role="alert">{t('Не удалось выполнить запрос. Попробуйте ещё раз.')}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(null)
                setDeleting(null)
              }}
            >
              {t('Отмена')}
            </Button>
            <Button
              disabled={busy || (!deleting && !title.trim())}
              onClick={() => void change(!!deleting)}
            >
              {t(deleting ? 'Удалить' : 'Сохранить')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}
