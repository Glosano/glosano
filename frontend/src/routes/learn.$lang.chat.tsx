import { createRoute, useParams } from '@tanstack/react-router'
import { ChatWorkspace } from '@/features/chat/ChatWorkspace'
import { learnLangRoute } from './learn.$lang'
export const learnChatRoute = createRoute({
  getParentRoute: () => learnLangRoute,
  path: 'chat',
  component: function ChatView() {
    const { lang } = useParams({ from: '/learn/$lang/chat' })
    return <ChatWorkspace lang={lang} />
  },
})
