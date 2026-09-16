import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'page' | 'sentence'

interface FontPrefs {
  size: 0 | 1 | 2
  lineHeight: 0 | 1 | 2
  serif: boolean
}

interface ReaderState {
  mode: ViewMode
  pageIndex: number
  sentenceFlatIndex: number
  sidebarOpen: boolean
  vocabularyPanelPinned: boolean
  lastBulkActionId: string | null
  font: FontPrefs
  wordCardExpanded: boolean
  setMode: (m: ViewMode) => void
  setPageIndex: (i: number) => void
  setSentenceFlatIndex: (i: number) => void
  toggleSidebar: () => void
  setVocabularyPanelPinned: (value: boolean) => void
  setLastBulkActionId: (id: string | null) => void
  setFont: (f: Partial<FontPrefs>) => void
  setWordCardExpanded: (v: boolean) => void
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      mode: 'page',
      pageIndex: 0,
      sentenceFlatIndex: 0,
      sidebarOpen: false,
      vocabularyPanelPinned: false,
      lastBulkActionId: null,
      font: { size: 1, lineHeight: 1, serif: false },
      wordCardExpanded: false,
      setMode: (mode) => set({ mode }),
      setPageIndex: (pageIndex) => set({ pageIndex }),
      setSentenceFlatIndex: (sentenceFlatIndex) => set({ sentenceFlatIndex }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setVocabularyPanelPinned: (vocabularyPanelPinned) => set({ vocabularyPanelPinned }),
      setLastBulkActionId: (lastBulkActionId) => set({ lastBulkActionId }),
      setFont: (f) => set((s) => ({ font: { ...s.font, ...f } })),
      setWordCardExpanded: (wordCardExpanded) => set({ wordCardExpanded }),
    }),
    {
      name: 'glosano-reader-prefs',
      partialize: (s) =>
        ({
          font: s.font,
          vocabularyPanelPinned: s.vocabularyPanelPinned,
        }) as Partial<ReaderState>,
    },
  ),
)
