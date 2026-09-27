// Ported from Plucker / copy-selection-as-markdown (MIT, © 0x6b and contributors).
// See THIRD_PARTY_NOTICES.md.

const hasText = (sel: Selection | null): sel is Selection => !!sel && sel.rangeCount > 0 && !sel.isCollapsed

// A collapsed cursor in the parent page does not count: the real selection may
// live in a same-origin iframe.
function activeSelection(doc: Document): Selection | null {
  const sel = doc.getSelection()
  if (hasText(sel)) return sel
  for (const frame of Array.from(doc.getElementsByTagName('iframe'))) {
    let frameSel: Selection | null = null
    try {
      frameSel = frame.contentDocument?.getSelection() ?? null
    } catch {
      continue // cross-origin frame
    }
    if (hasText(frameSel)) return frameSel
  }
  return null
}

/** Clones every range of the current selection (or of a same-origin iframe's selection). */
export function getSelectionFragment(doc: Document): DocumentFragment | null {
  const sel = activeSelection(doc)
  if (!sel) return null
  const fragment = doc.createDocumentFragment()
  for (let i = 0; i < sel.rangeCount; i++) {
    const wrapper = doc.createElement('div')
    wrapper.appendChild(sel.getRangeAt(i).cloneContents())
    fragment.appendChild(wrapper)
  }
  return fragment
}
