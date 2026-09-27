// Ported from Plucker / copy-selection-as-markdown (MIT, © 0x6b and contributors).
// See THIRD_PARTY_NOTICES.md.
import { t } from '../i18n'

export const OVERLAY_HOST_ID = 'glosano-picker-overlay'
const ACCENT = '#2563eb'
const ACCENT_HOVER = '#1d4ed8'
// Visual constants inspired by the Evernote Web Clipper look (values read
// from its public CSS; no Evernote code is reused).
const PANEL_BG = '#2f373d'

const STYLE = `
  .panel {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: ${PANEL_BG};
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    font: 13px/1.2 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #fff;
    white-space: nowrap;
    pointer-events: auto;
    z-index: 2147483647;
  }
  .panel button {
    font: inherit;
    color: #fff;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .panel button:hover { background: rgba(255, 255, 255, 0.15); }
  .panel button[data-action=import] {
    background: ${ACCENT};
    border-color: ${ACCENT};
    font-weight: 600;
  }
  .panel button[data-action=import]:hover { background: ${ACCENT_HOVER}; }
  .panel button:disabled { opacity: .5; cursor: default; }
  .status { font-weight: 600; }
  .status.error { color: #ff8080; }
  .veil {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.5);
    pointer-events: none;
    z-index: 2147483645;
  }
`

export interface PanelOptions {
  mode: 'article' | 'blocks'
  onExpand?: () => void
  onNarrow?: () => void
  onImport: () => void
  onCancel: () => void
}

export class PickerOverlay {
  doc: Document
  win: (Window & typeof globalThis) | null
  frameNode: Element | null = null
  anchorNode: Element | null = null
  hoverNode: Element | null = null
  hoverSavedOutline = ''
  selectedSaved: Map<Element, string> = new Map()
  frameSavedOutline = ''
  veil: HTMLElement | null = null
  host: HTMLElement
  shadow: ShadowRoot
  panel: HTMLElement
  countEl: HTMLSpanElement | null = null
  statusEl: HTMLSpanElement | null = null
  importButton: HTMLButtonElement | null = null

  constructor(doc: Document = document) {
    doc.getElementById(OVERLAY_HOST_ID)?.remove()

    this.doc = doc
    this.win = doc.defaultView

    this.host = doc.createElement('div')
    this.host.id = OVERLAY_HOST_ID
    this.host.style.cssText =
      'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;'
    // Closed: page scripts cannot reach the panel and click Import through host.shadowRoot.
    this.shadow = this.host.attachShadow({ mode: 'closed' })

    const style = doc.createElement('style')
    style.textContent = STYLE
    this.shadow.appendChild(style)

    this.panel = doc.createElement('div')
    this.panel.className = 'panel'
    this.shadow.appendChild(this.panel)

    doc.documentElement.appendChild(this.host)
  }

  contains(target: EventTarget | null): boolean {
    return target === this.host || this.host.contains(target as Node | null)
  }

  setPanel({ mode, onExpand, onNarrow, onImport, onCancel }: PanelOptions): void {
    this.panel.textContent = ''
    this.countEl = null
    const button = (action: string, label: string, handler: () => void, title?: string) => {
      const b = this.doc.createElement('button')
      b.dataset.action = action
      b.textContent = label
      if (title) b.title = title
      b.addEventListener('click', handler)
      this.panel.appendChild(b)
      return b
    }
    if (mode === 'article') {
      button('narrow', '−', () => onNarrow?.(), t('picker_narrow'))
      button('expand', '+', () => onExpand?.(), t('picker_expand'))
    } else {
      this.countEl = this.doc.createElement('span')
      this.countEl.dataset.role = 'count'
      this.countEl.textContent = t('picker_selected', '0')
      this.panel.appendChild(this.countEl)
    }
    this.statusEl = this.doc.createElement('span')
    this.statusEl.className = 'status'
    this.statusEl.hidden = true
    this.panel.appendChild(this.statusEl)
    this.importButton = button('import', t('picker_import'), onImport, t('picker_import_hint'))
    button('cancel', '✕', onCancel, t('picker_cancel'))
  }

  setCount(count: number): void {
    if (this.countEl) this.countEl.textContent = t('picker_selected', String(count))
  }

  private setStatus(text: string, error: boolean): void {
    if (!this.statusEl) return
    this.statusEl.hidden = false
    this.statusEl.classList.toggle('error', error)
    this.statusEl.textContent = text
  }

  showBusy(): void {
    if (this.importButton) this.importButton.disabled = true
    this.setStatus(t('picker_importing'), false)
  }

  showSuccess(lessonUrl: string | null, onOpen: (url: string) => void): void {
    this.setStatus(t('picker_imported'), false)
    this.importButton?.remove()
    this.importButton = null
    if (lessonUrl) {
      const open = this.doc.createElement('button')
      open.dataset.action = 'open'
      open.textContent = t('picker_open_lesson')
      open.addEventListener('click', () => onOpen(lessonUrl))
      this.statusEl?.after(open)
    }
  }

  showError(message: string): void {
    if (this.importButton) this.importButton.disabled = false
    this.setStatus(message, true)
  }

  showFrame(node: Element): void {
    if (this.frameNode === node) return
    this.clearFrame()
    this.frameNode = node
    this.anchorNode = node
    const el = node as HTMLElement
    this.frameSavedOutline = el.style.outline
    el.style.outline = `4px solid ${ACCENT}`

    if (!this.veil) {
      this.veil = this.doc.createElement('div')
      this.veil.className = 'veil'
      this.shadow.insertBefore(this.veil, this.panel)
    }
    this.updatePositions()
  }

  clearFrame(): void {
    if (this.frameNode) {
      ;(this.frameNode as HTMLElement).style.outline = this.frameSavedOutline
      this.frameNode = null
    }
  }

  showHover(node: Element | null): void {
    if (node === this.hoverNode) return
    this.clearHover()
    if (!node || this.selectedSaved.has(node)) return
    this.hoverNode = node
    const el = node as HTMLElement
    this.hoverSavedOutline = el.style.outline
    el.style.outline = `3px dashed ${ACCENT}`
  }

  clearHover(): void {
    if (this.hoverNode) {
      ;(this.hoverNode as HTMLElement).style.outline = this.hoverSavedOutline
      this.hoverNode = null
    }
  }

  markSelected(nodes: Element[]): void {
    const next = new Set(nodes)
    for (const [node, saved] of this.selectedSaved) {
      if (!next.has(node)) {
        ;(node as HTMLElement).style.outline = saved
        this.selectedSaved.delete(node)
      }
    }
    for (const node of next) {
      if (!this.selectedSaved.has(node)) {
        if (node === this.hoverNode) this.clearHover()
        const el = node as HTMLElement
        this.selectedSaved.set(node, el.style.outline)
        el.style.outline = `3px solid ${ACCENT}`
      }
    }
    this.anchorNode = nodes.length > 0 ? nodes[0]! : null
    this.updatePositions()
  }

  // Repositions the panel onto the top edge of the anchor node and updates
  // the veil cutout. With no anchor the panel stays centered at the top of
  // the viewport (CSS defaults).
  updatePositions(): void {
    if (this.anchorNode) {
      const rect = this.anchorNode.getBoundingClientRect()
      // Keep the panel visible when the frame's top edge scrolls off-screen.
      const top = Math.max(rect.top, 24)
      this.panel.style.left = `${rect.left + rect.width / 2}px`
      this.panel.style.top = `${top}px`
      if (this.veil && this.win) {
        const w = this.win.innerWidth
        const h = this.win.innerHeight
        this.veil.style.clipPath = `polygon(evenodd,
          0 0, ${w}px 0, ${w}px ${h}px, 0 ${h}px, 0 0,
          ${rect.left}px ${rect.top}px, ${rect.right}px ${rect.top}px,
          ${rect.right}px ${rect.bottom}px, ${rect.left}px ${rect.bottom}px,
          ${rect.left}px ${rect.top}px)`
      }
    } else {
      this.panel.style.left = ''
      this.panel.style.top = ''
      if (this.veil) {
        this.veil.style.clipPath = ''
      }
    }
  }

  destroy(): void {
    this.clearFrame()
    this.clearHover()
    for (const [node, saved] of this.selectedSaved) {
      ;(node as HTMLElement).style.outline = saved
    }
    this.selectedSaved.clear()
    this.host.remove()
  }
}
