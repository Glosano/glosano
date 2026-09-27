// Ported from Plucker / copy-selection-as-markdown (MIT, © 0x6b and contributors).
// See THIRD_PARTY_NOTICES.md.

// `div` is intentionally included: selection precision relies on the
// inside-out climb in findBlockCandidate (innermost matching block wins).
const BLOCK_SELECTOR = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre', 'blockquote',
  'figure', 'img', 'video', 'section', 'article', 'div',
].join(', ')

const hasContent = (el: Element) => el.matches('img, video, figure') || (el.textContent ?? '').trim().length > 0

export function defaultIsVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

// Walks up from the event target to the nearest selectable block element.
// Returns null when nothing inside `root` qualifies (root itself excluded).
export function findBlockCandidate(
  target: EventTarget | null,
  root: Element,
  isVisible: (el: Element) => boolean = defaultIsVisible,
): Element | null {
  let el: Element | null = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  while (el && el !== root) {
    if (el.matches(BLOCK_SELECTOR) && hasContent(el) && isVisible(el)) return el
    el = el.parentElement
  }
  return null
}

// Toggles `el` in the selected set with deduplication: a descendant of a
// selected block is ignored; selecting an ancestor absorbs its descendants.
export function toggleBlock(selected: Set<Element>, el: Element): Set<Element> {
  if (selected.has(el)) {
    selected.delete(el)
    return selected
  }
  for (const existing of Array.from(selected)) {
    if (existing.contains(el)) return selected
    if (el.contains(existing)) selected.delete(existing)
  }
  selected.add(el)
  return selected
}

export function sortByDocumentOrder(elements: Iterable<Element>): Element[] {
  return Array.from(elements).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}
