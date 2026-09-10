import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import type { SelectedItem } from './selectedItem'
import type { VocabularyTab } from './lessonVocabulary'

const DESKTOP_QUERY = '(min-width: 1024px)'

export interface LessonVocabularyPanelProps {
  lessonId: string
  pinned: boolean
  selectedWord: SelectedItem | null
  onClearSelection: () => void
  onHide: () => void
  card: ReactNode
  renderList: (state: {
    tab: VocabularyTab
    onTabChange: (tab: VocabularyTab) => void
    scrollTop: number
    onScrollTopChange: (top: number) => void
  }) => ReactNode
}

function useDesktopPanel(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia(DESKTOP_QUERY).matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DESKTOP_QUERY)
    const onChange = (event: MediaQueryListEvent) => setDesktop(event.matches)
    setDesktop(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return desktop
}

export function LessonVocabularyPanel({
  pinned,
  selectedWord,
  onClearSelection,
  onHide,
  card,
  renderList,
}: LessonVocabularyPanelProps) {
  const desktop = useDesktopPanel()
  const visible = pinned || selectedWord !== null
  const [tab, setTab] = useState<VocabularyTab>('added')
  const [scrollPositions, setScrollPositions] = useState<Record<VocabularyTab, number>>({
    added: 0,
    new: 0,
    all: 0,
  })
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const listSlotRef = useRef<HTMLDivElement | null>(null)
  const listFocusRef = useRef<HTMLElement | null>(null)
  const previousSelectedRef = useRef(selectedWord)

  useEffect(() => {
    if (visible && !restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement
    }
    if (!visible && restoreFocusRef.current) {
      restoreFocusRef.current.focus()
      restoreFocusRef.current = null
    }
  }, [visible])

  useEffect(() => {
    const previous = previousSelectedRef.current
    if (!previous && selectedWord && listSlotRef.current?.contains(document.activeElement)) {
      listFocusRef.current = document.activeElement as HTMLElement
    }
    if (previous && !selectedWord && pinned) {
      const target = listFocusRef.current?.isConnected
        ? listFocusRef.current
        : listSlotRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      target?.focus()
      listFocusRef.current = null
    }
    previousSelectedRef.current = selectedWord
  }, [pinned, selectedWord])

  const onScrollTopChange = useCallback(
    (top: number) => {
      setScrollPositions((current) => ({ ...current, [tab]: top }))
    },
    [tab],
  )

  const dismissCurrentLayer = useCallback(() => {
    if (pinned && selectedWord) {
      onClearSelection()
      return
    }
    onHide()
  }, [onClearSelection, onHide, pinned, selectedWord])

  if (!visible) return null

  const body = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {pinned && (
        <div
          ref={listSlotRef}
          data-testid="lesson-vocabulary-list-slot"
          aria-hidden={selectedWord ? true : undefined}
          inert={selectedWord ? true : undefined}
          className={
            selectedWord
              ? 'pointer-events-none absolute inset-0 invisible flex min-h-0 flex-col'
              : 'flex min-h-0 flex-1 flex-col'
          }
        >
          <button
            type="button"
            aria-label="Скрыть словарь урока"
            onClick={onHide}
            className="absolute right-3 top-3 z-10 rounded-md p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="shrink-0 px-4 py-4 pr-12 text-base font-semibold">Словарь урока</h2>
          {renderList({
            tab,
            onTabChange: setTab,
            scrollTop: scrollPositions[tab],
            onScrollTopChange,
          })}
        </div>
      )}
      {selectedWord && <div className="min-h-0 flex-1 overflow-y-auto">{card}</div>}
    </div>
  )

  if (desktop) {
    return (
      <aside
        id="lesson-vocabulary-panel"
        aria-label="Словарь урока"
        data-reader-panel
        className="fixed bottom-24 right-4 top-20 z-[var(--z-fixed)] flex w-[var(--reader-panel-width)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        {body}
      </aside>
    )
  }

  return (
    <DialogPrimitive.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) dismissCurrentLayer()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/10" />
        <DialogPrimitive.Content
          id="lesson-vocabulary-panel"
          aria-describedby={undefined}
          data-reader-panel
          className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex max-h-[85dvh] min-h-0 flex-col overflow-hidden rounded-t-xl border border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-lg outline-none"
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            dismissCurrentLayer()
          }}
        >
          <DialogPrimitive.Title className="sr-only">Словарь урока</DialogPrimitive.Title>
          {body}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
