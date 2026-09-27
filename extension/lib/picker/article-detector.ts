// Ported from Plucker / copy-selection-as-markdown (MIT, © 0x6b and contributors).
// See THIRD_PARTY_NOTICES.md.
import { Readability } from '@mozilla/readability'

const ID_ATTR = 'data-glosano-id'
// Skip Readability on pathologically large pages to avoid freezing the tab.
export const MAX_ELEMENTS = 50000
const FALLBACK_SELECTORS = ['article', 'main', '[role=main]']

export function findFallbackNode(doc: Document): Element {
  for (const selector of FALLBACK_SELECTORS) {
    const node = doc.querySelector(selector)
    if (node) return node
  }
  return doc.body ?? doc.documentElement
}

function findCommonAncestor(doc: Document, ids: string[]): Element | null {
  const byId = new Map<string, Element>()
  for (const el of Array.from(doc.querySelectorAll(`[${ID_ATTR}]`))) byId.set(el.getAttribute(ID_ATTR)!, el)
  let node: Element | null = byId.get(ids[0]!) ?? null
  for (const id of ids.slice(1)) {
    const el = byId.get(id)
    if (!el) continue
    while (node && !node.contains(el)) node = node.parentElement
  }
  return node
}

// Detects the main article node on the LIVE document. Readability runs on a
// clone (it mutates its input); temporary data attributes map its output back
// to live nodes. Always returns a usable node (fallback chain ends at <body>).
export function detectArticleNode(doc: Document): Element {
  if (!doc.body) return findFallbackNode(doc)
  const elements = doc.body.getElementsByTagName('*')
  if (elements.length > MAX_ELEMENTS) return findFallbackNode(doc)
  let id = 0
  for (const el of Array.from(elements)) el.setAttribute(ID_ATTR, String(id++))
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse()
    if (!article?.content) return findFallbackNode(doc)
    // Parse in an inert document so the article markup cannot load images
    // or run inline handlers in the page.
    const probe = doc.implementation.createHTMLDocument('').createElement('div')
    probe.innerHTML = article.content
    const ids = Array.from(probe.querySelectorAll(`[${ID_ATTR}]`)).map((el) => el.getAttribute(ID_ATTR)!)
    if (ids.length === 0) return findFallbackNode(doc)
    return findCommonAncestor(doc, ids) ?? findFallbackNode(doc)
  } catch (error) {
    console.error(error)
    return findFallbackNode(doc)
  } finally {
    for (const el of Array.from(doc.querySelectorAll(`[${ID_ATTR}]`))) el.removeAttribute(ID_ATTR)
  }
}

export function expandNode(node: Element): Element {
  if (node === node.ownerDocument.body || !node.parentElement) return node
  return node.parentElement
}

export function narrowNode(node: Element): Element {
  let best: Element | null = null
  let bestLength = 0
  for (const child of Array.from(node.children)) {
    const length = (child.textContent ?? '').trim().length
    if (length > bestLength) {
      best = child
      bestLength = length
    }
  }
  return best ?? node
}
