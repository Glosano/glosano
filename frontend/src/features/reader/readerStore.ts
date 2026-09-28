import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewMode = 'page' | 'sentence'
/** What video playback does when the reader turns to the next page or fragment. */
export type VideoAdvance = 'stop' | 'play' | 'auto'

interface FontPrefs {
  size: 0 | 1 | 2
  lineHeight: 0 | 1 | 2
  serif: boolean
}

interface ReaderState {
  mode: ViewMode
  pageIndex: number
  sentenceFlatIndex: number
  vocabularyPanelPinned: boolean
  lastBulkActionId: string | null
  font: FontPrefs
  wordCardExpanded: boolean
  videoAdvance: VideoAdvance
  setMode: (m: ViewMode) => void
  setPageIndex: (i: number) => void
  setSentenceFlatIndex: (i: number) => void
  setVocabularyPanelPinned: (value: boolean) => void
  setLastBulkActionId: (id: string | null) => void
  setFont: (f: Partial<FontPrefs>) => void
  setWordCardExpanded: (v: boolean) => void
  setVideoAdvance: (v: VideoAdvance) => void
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      mode: 'page',
      pageIndex: 0,
      sentenceFlatIndex: 0,
      vocabularyPanelPinned: false,
      lastBulkActionId: null,
      font: { size: 1, lineHeight: 1, serif: false },
      wordCardExpanded: false,
      videoAdvance: 'stop',
      setMode: (mode) => set({ mode }),
      setPageIndex: (pageIndex) => set({ pageIndex }),
      setSentenceFlatIndex: (sentenceFlatIndex) => set({ sentenceFlatIndex }),
      setVocabularyPanelPinned: (vocabularyPanelPinned) => set({ vocabularyPanelPinned }),
      setLastBulkActionId: (lastBulkActionId) => set({ lastBulkActionId }),
      setFont: (f) => set((s) => ({ font: { ...s.font, ...f } })),
      setWordCardExpanded: (wordCardExpanded) => set({ wordCardExpanded }),
      setVideoAdvance: (videoAdvance) => set({ videoAdvance }),
    }),
    {
      name: 'glosano-reader-prefs',
      partialize: (s) =>
        ({
          font: s.font,
          vocabularyPanelPinned: s.vocabularyPanelPinned,
          videoAdvance: s.videoAdvance,
        }) as Partial<ReaderState>,
    },
  ),
)
