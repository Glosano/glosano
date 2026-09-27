// Event wiring ported from Plucker / copy-selection-as-markdown (MIT, © 0x6b and contributors).
// See THIRD_PARTY_NOTICES.md.
import { errorMessage } from '../errors'
import { nodesToLessonText } from '../extract/html-to-text'
import type { LessonSourceInput } from '../glosano-client'
import type { ImportResult, ImportTextRequest } from '../messages'
import { detectArticleNode, expandNode, narrowNode } from './article-detector'
import { defaultIsVisible, findBlockCandidate, sortByDocumentOrder, toggleBlock } from './block-selection'
import { PickerOverlay } from './overlay'

export const PICKER_PARAMS_GLOBAL = '__glosanoPicker'
const CLEANUP_GLOBAL = '__glosanoPickerCleanup'

export interface PickerParams {
  mode: 'article' | 'blocks'
  title: string
  language_code: string
  source: LessonSourceInput
  tags?: string[]
}

export interface SessionDeps {
  importText: (request: ImportTextRequest) => Promise<ImportResult>
  openUrl: (url: string) => void
  isVisible?: (el: Element) => boolean
  /** Defaults to `e.isTrusted`, so page scripts cannot drive the picker with synthetic events. */
  isTrustedEvent?: (e: Event) => boolean
}

type Listener = [EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined]

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function startPickerSession(doc: Document, params: PickerParams, deps: SessionDeps): () => void {
  const win = doc.defaultView as (Window & Record<string, unknown>) | null
  const previous = win?.[CLEANUP_GLOBAL]
  if (typeof previous === 'function') (previous as () => void)()

  const overlay = new PickerOverlay(doc)
  const listeners: Listener[] = []
  const on = (target: EventTarget, type: string, handler: EventListener, opts?: AddEventListenerOptions | boolean) => {
    target.addEventListener(type, handler, opts)
    listeners.push([target, type, handler, opts])
  }
  let active = true
  let busy = false
  // After a successful import the page goes back to the user: only Esc, ✕ and
  // "Open lesson" still work, so the same text cannot be imported twice.
  let done = false
  const isTrusted = deps.isTrustedEvent ?? ((e: Event) => e.isTrusted)
  const cleanup = () => {
    if (!active) return
    active = false
    for (const [target, type, handler, opts] of listeners) target.removeEventListener(type, handler, opts)
    overlay.destroy()
    if (win && win[CLEANUP_GLOBAL] === cleanup) delete win[CLEANUP_GLOBAL]
  }
  if (win) win[CLEANUP_GLOBAL] = cleanup

  const submit = async (nodes: Element[]) => {
    if (busy || done || !active) return
    const text = nodesToLessonText(nodes)
    if (!text.trim()) {
      overlay.showError(errorMessage({ code: 'empty_text' }))
      return
    }
    busy = true
    overlay.showBusy()
    let result: ImportResult
    try {
      result = await deps.importText({
        title: params.title,
        language_code: params.language_code,
        text,
        source: params.source,
        ...(params.tags ? { tags: params.tags } : {}),
      })
    } catch (error) {
      // runtime.sendMessage rejects when the extension was reloaded or its context is gone.
      result = { ok: false, error: { code: 'unknown', detail: String(error) } }
    } finally {
      busy = false
    }
    if (!active) return
    if (result.ok) {
      done = true
      overlay.clearHover()
      overlay.showSuccess(result.lessonUrl, (url) => deps.openUrl(url))
    } else overlay.showError(errorMessage(result.error))
  }

  let queued = false
  const queuePositionUpdate = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      overlay.updatePositions()
    })
  }
  if (win) {
    on(win, 'scroll', queuePositionUpdate, { capture: true, passive: true })
    on(win, 'resize', queuePositionUpdate, { passive: true })
    on(win, 'pagehide', cleanup)
  }

  const handled = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }

  if (params.mode === 'article') {
    let node = detectArticleNode(doc)
    const expand = () => {
      if (!done) overlay.showFrame((node = expandNode(node)))
    }
    const narrow = () => {
      if (!done) overlay.showFrame((node = narrowNode(node)))
    }
    overlay.setPanel({ mode: 'article', onExpand: expand, onNarrow: narrow, onImport: () => void submit([node]), onCancel: cleanup })
    overlay.showFrame(node)
    on(
      doc,
      'keydown',
      ((e: KeyboardEvent) => {
        if (!isTrusted(e) || isEditableTarget(e.target)) return
        if (e.key === 'Escape') cleanup()
        else if (done) return
        else if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') expand()
        else if (e.key === '-' || e.key === 'ArrowDown') narrow()
        else if (e.key === 'Enter') void submit([node])
        else return
        handled(e)
      }) as EventListener,
      true,
    )
  } else {
    const isVisible = deps.isVisible ?? defaultIsVisible
    const selected = new Set<Element>()
    const importSelected = () => {
      if (selected.size > 0) void submit(sortByDocumentOrder(selected))
    }
    overlay.setPanel({ mode: 'blocks', onImport: importSelected, onCancel: cleanup })
    on(
      doc,
      'mousemove',
      ((e: MouseEvent) => {
        if (done || !isTrusted(e)) return
        if (overlay.contains(e.target)) return overlay.clearHover()
        overlay.showHover(findBlockCandidate(e.target, doc.body, isVisible))
      }) as EventListener,
      true,
    )
    on(
      doc,
      'click',
      ((e: MouseEvent) => {
        if (done || !isTrusted(e) || overlay.contains(e.target)) return
        handled(e)
        const candidate = findBlockCandidate(e.target, doc.body, isVisible)
        if (!candidate) return
        toggleBlock(selected, candidate)
        overlay.markSelected(sortByDocumentOrder(selected))
        overlay.setCount(selected.size)
      }) as EventListener,
      true,
    )
    on(
      doc,
      'keydown',
      ((e: KeyboardEvent) => {
        if (!isTrusted(e) || isEditableTarget(e.target)) return
        if (e.key === 'Escape') cleanup()
        else if (!done && e.key === 'Enter') importSelected()
        else return
        handled(e)
      }) as EventListener,
      true,
    )
  }

  return cleanup
}
