import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useChatLayoutStore = create<{
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    { name: 'glosano-chat-layout' },
  ),
)
