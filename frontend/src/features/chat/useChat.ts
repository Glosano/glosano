import { useEffect } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { chatsApi } from '@/api/chats'
import { chatDrafts, useChatStore } from './chatStore'

export function useDraft(id: string | null) {
  const uid = useChatStore((s) => s.userId)
  const entry = useChatStore((s) => s.entries[id ?? 'new']) ?? chatDrafts.get(id)
  useEffect(() => {
    if (uid) void chatDrafts.load(id).catch(() => {})
    return () => {
      if (uid) void chatDrafts.flush(id).catch(() => {})
    }
  }, [id, uid])
  return entry
}
export function useChatList() {
  const uid = useChatStore((s) => s.userId)
  return useInfiniteQuery({
    queryKey: ['chats', uid, 'list'],
    enabled: !!uid,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => chatsApi.list(pageParam),
    getNextPageParam: (last, all) =>
      last.items.length === 50 ? all.reduce((n, p) => n + p.items.length, 0) : undefined,
  })
}
export function useChat(id: string | null) {
  const uid = useChatStore((s) => s.userId)
  const capabilities = useQuery({
    queryKey: ['chats', uid, 'capabilities'],
    queryFn: chatsApi.capabilities,
    enabled: !!uid,
    refetchInterval: 30000,
  })
  const history = useInfiniteQuery({
    queryKey: ['chats', uid, 'detail', id],
    enabled: !!uid && !!id,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => chatsApi.detail(id!, pageParam),
    getNextPageParam: (last) =>
      last.messages.length === 50 ? last.messages[0]?.created_at : undefined,
    refetchInterval: (q) =>
      q.state.data?.pages[0]?.generations.some(
        (g) => g.status === 'queued' || g.status === 'running',
      )
        ? 1000
        : 5000,
  })
  const detail = history.data?.pages[0]
  const messages = [
    ...new Map(
      (history.data?.pages.flatMap((p) => p.messages) ?? []).map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return {
    history,
    detail,
    messages,
    capabilities,
    aiEnabled: capabilities.data?.ai_enabled === true && detail?.ai_enabled !== false,
  }
}
