import { create } from 'zustand'

interface LibraryState {
  search: string
  setSearch: (q: string) => void
  reset: () => void
}

export const useLibraryStore = create<LibraryState>((set) => ({
  search: '',
  setSearch: (search) => set({ search }),
  reset: () => set({ search: '' }),
}))
