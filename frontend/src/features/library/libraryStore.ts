import { create } from 'zustand'

interface LibraryState {
  search: string
  /** Selected tags belong to one learning language; another language sees none. */
  tagsLang: string | null
  tags: string[]
  setSearch: (q: string) => void
  toggleTag: (lang: string, tag: string) => void
  addTag: (lang: string, tag: string) => void
  clearTags: () => void
  reset: () => void
}

const NO_TAGS: string[] = []

function selected(state: LibraryState, lang: string): string[] {
  return state.tagsLang === lang ? state.tags : NO_TAGS
}

export const useLibraryStore = create<LibraryState>((set) => ({
  search: '',
  tagsLang: null,
  tags: NO_TAGS,
  setSearch: (search) => set({ search }),
  toggleTag: (lang, tag) =>
    set((state) => {
      const tags = selected(state, lang)
      return {
        tagsLang: lang,
        tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
      }
    }),
  addTag: (lang, tag) =>
    set((state) => {
      const tags = selected(state, lang)
      return tags.includes(tag) ? {} : { tagsLang: lang, tags: [...tags, tag] }
    }),
  clearTags: () => set({ tagsLang: null, tags: NO_TAGS }),
  reset: () => set({ search: '', tagsLang: null, tags: NO_TAGS }),
}))

export function useSelectedTags(lang: string): string[] {
  return useLibraryStore((state) => selected(state, lang))
}
