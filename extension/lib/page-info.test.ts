import { collectPageInfo, type PageInfo } from './page-info'

const LONG = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(12)

describe('collectPageInfo', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.documentElement.removeAttribute('lang')
    document.getSelection()!.removeAllRanges()
  })

  it('reads title, byline, site name and language', () => {
    document.documentElement.lang = 'pt-BR'
    // Set the meta tags before document.title: assigning head.innerHTML replaces
    // the whole head, including any <title> element the title setter created.
    document.head.innerHTML = '<meta property="og:site_name" content="Jornal"><meta name="author" content="Ana Souza">'
    // A title long enough (6+ words before the separator) that Readability's own
    // extraction keeps it and strips the " | Jornal" suffix, so this proves the
    // Readability path is used rather than the raw document.title fallback (which
    // would keep the suffix).
    document.title = 'Um grande título sobre Lisboa hoje | Jornal'
    document.body.innerHTML = `<article><h1>Grande título</h1>${Array.from({ length: 6 }, () => `<p>${LONG}</p>`).join('')}</article>`
    const info = collectPageInfo(document)
    expect(info.url).toBe(document.URL)
    expect(info.title).toBe('Um grande título sobre Lisboa hoje')
    expect(info.byline).toBe('Ana Souza')
    expect(info.siteName).toBe('Jornal')
    expect(info.lang).toBe('pt-BR')
    expect(info.selection).toBe('')
  })

  it('returns a PageInfo without throwing when the document has no <body>', () => {
    document.body.innerHTML = '<p>text</p>'
    document.title = 'Sem corpo'
    const body = document.body
    body.remove()
    try {
      expect(document.body).toBeNull()
      let info: PageInfo | undefined
      expect(() => {
        info = collectPageInfo(document)
      }).not.toThrow()
      expect(info?.title).toBe('Sem corpo')
      expect(info?.byline).toBeNull()
      expect(info?.selection).toBe('')
    } finally {
      // Restore <body> so later tests in this file keep a working document.body.
      document.documentElement.appendChild(body)
    }
  })

  it('falls back to og:title and document.title', () => {
    document.title = 'Título da aba'
    document.head.innerHTML = '<meta property="og:title" content="Título OG">'
    document.body.innerHTML = '<p>curto</p>'
    expect(collectPageInfo(document).title).toBe('Título OG')
    document.head.innerHTML = ''
    document.title = 'Título da aba'
    expect(collectPageInfo(document).title).toBe('Título da aba')
  })

  it('returns the selected text as lesson text', () => {
    document.body.innerHTML = '<p id="a">Primeiro.</p><p id="b">Segundo.</p>'
    const range = document.createRange()
    range.setStartBefore(document.getElementById('a')!)
    range.setEndAfter(document.getElementById('b')!)
    document.getSelection()!.addRange(range)
    expect(collectPageInfo(document).selection).toBe('Primeiro.\n\nSegundo.')
  })

  it('does not modify the page', () => {
    document.body.innerHTML = `<main><p>${LONG}</p></main>`
    const before = document.body.innerHTML
    collectPageInfo(document)
    expect(document.body.innerHTML).toBe(before)
  })
})
