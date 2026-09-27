const REMOVED = [
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed',
  'nav', 'aside', 'footer', 'button', 'select', 'input', 'textarea',
  'figure', 'figcaption', 'img', 'picture', 'video', 'audio',
  '[hidden]', '[aria-hidden="true"]',
].join(',')

const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL', 'CAPTION',
])
const CELLS = new Set(['TD', 'TH'])

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef'
const CJK_GAP = new RegExp(`([${CJK}]) (?=[${CJK}])`, 'gu')

class Collector {
  readonly paragraphs: string[] = []
  private buffer = ''
  private pre = false

  text(value: string, pre: boolean): void {
    if (pre) this.pre = true
    this.buffer += pre ? value : value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
  }

  lineBreak(): void {
    this.buffer += '\n'
  }

  flush(): void {
    const lines = this.buffer.split('\n')
    const cleaned = this.pre
      ? lines.map((l) => l.replace(/\s+$/, ''))
      : lines.map((l) => l.replace(/[ \t]+/g, ' ').trim().replace(CJK_GAP, '$1'))
    const paragraph = cleaned.join('\n').replace(/^\n+|\n+$/g, '')
    if (paragraph.trim()) this.paragraphs.push(paragraph)
    this.buffer = ''
    this.pre = false
  }
}

function walk(node: Node, out: Collector, pre: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.text(node.nodeValue ?? '', pre)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  if (el.tagName === 'BR') {
    out.lineBreak()
    return
  }
  const block = BLOCKS.has(el.tagName)
  const inPre = pre || el.tagName === 'PRE'
  if (block) out.flush()
  for (const child of Array.from(el.childNodes)) walk(child, out, inPre)
  if (block) out.flush()
  else if (CELLS.has(el.tagName)) out.text(' ', false)
}

// Built in a document with no browsing context: markup parsed or imported
// there does not load images or run inline handlers in the page.
function inertContainer(doc: Document): HTMLElement {
  return doc.implementation.createHTMLDocument('').createElement('div')
}

function collect(container: HTMLElement): string {
  for (const el of Array.from(container.querySelectorAll(REMOVED))) el.remove()
  const out = new Collector()
  walk(container, out, false)
  out.flush()
  return out.paragraphs.join('\n\n')
}

/** Clones the given live nodes and serializes them as lesson text; the page is not modified. */
export function nodesToLessonText(nodes: Node[]): string {
  const doc = nodes[0]?.ownerDocument ?? document
  const container = inertContainer(doc)
  for (const node of nodes) container.appendChild(container.ownerDocument.importNode(node, true))
  return collect(container)
}

export function htmlToLessonText(html: string, doc: Document = document): string {
  const container = inertContainer(doc)
  container.innerHTML = html
  return collect(container)
}
