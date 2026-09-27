import { htmlToLessonText, nodesToLessonText } from './html-to-text'

describe('htmlToLessonText', () => {
  it('separates block elements with blank lines', () => {
    expect(htmlToLessonText('<h1>Título</h1><p>Um  texto\n curto.</p><p>Outro.</p>')).toBe('Título\n\nUm texto curto.\n\nOutro.')
  })

  it('keeps <br> as a line break inside a paragraph', () => {
    expect(htmlToLessonText('<p>linha um<br>linha dois</p>')).toBe('linha um\nlinha dois')
  })

  it('turns list items into separate paragraphs', () => {
    expect(htmlToLessonText('<ul><li>um</li><li>dois</li></ul>')).toBe('um\n\ndois')
  })

  it('drops non-content elements', () => {
    const html = `
      <p>fica</p>
      <script>var x = 1</script><style>p{}</style><noscript>no</noscript>
      <nav>menu</nav><aside>aside</aside><footer>foot</footer>
      <figure><img src="a.png"><figcaption>legenda</figcaption></figure>
      <button>Share</button><p hidden>escondido</p><p aria-hidden="true">aria</p>
      <iframe src="x"></iframe><svg><text>svg</text></svg>`
    expect(htmlToLessonText(html)).toBe('fica')
  })

  it('keeps text wrapped in a form (WebForms-style pages)', () => {
    expect(htmlToLessonText('<form><div><p>Artigo inteiro.</p></div></form>')).toBe('Artigo inteiro.')
  })

  it('converts NBSP and collapses whitespace', () => {
    expect(htmlToLessonText('<p>  a&nbsp;&nbsp;b \t c  </p>')).toBe('a b c')
  })

  it('keeps inline markup inside the paragraph', () => {
    expect(htmlToLessonText('<p>Eu <b>gosto</b> de <a href="#">café</a>.</p>')).toBe('Eu gosto de café.')
  })

  it('preserves line structure inside <pre>', () => {
    expect(htmlToLessonText('<pre>a  b\n  c</pre>')).toBe('a  b\n  c')
  })

  it('separates table cells', () => {
    expect(htmlToLessonText('<table><tr><td>um</td><td>dois</td></tr><tr><td>três</td></tr></table>')).toBe('um dois\n\ntrês')
  })

  it('does not insert spaces between CJK characters split by inline tags', () => {
    expect(htmlToLessonText('<p><span>我喜欢</span>\n<span>学习</span>。</p>')).toBe('我喜欢学习。')
    expect(htmlToLessonText('<p><ruby>日本</ruby> <span>語</span></p>')).toBe('日本語')
  })

  it('keeps spaces between CJK and Latin words', () => {
    expect(htmlToLessonText('<p>我 like 学习</p>')).toBe('我 like 学习')
  })

  it('returns empty string for whitespace-only content', () => {
    expect(htmlToLessonText('<div>  <p> </p> </div>')).toBe('')
  })
})

describe('nodesToLessonText', () => {
  it('joins several nodes as separate paragraphs without mutating the page', () => {
    document.body.innerHTML = '<p id="a">Um.</p><nav id="n">menu</nav><p id="b">Dois.</p>'
    const nodes = [document.getElementById('a')!, document.getElementById('b')!]
    expect(nodesToLessonText(nodes)).toBe('Um.\n\nDois.')
    expect(document.getElementById('n')).not.toBeNull()
  })
})

describe('inert parsing', () => {
  afterEach(() => vi.restoreAllMocks())

  // Markup owned by the live document starts image loads and can run inline
  // handlers in the page; parsing must happen in an inert document.
  it('does not build markup with the live document', () => {
    const create = vi.spyOn(document, 'createElement')
    document.body.innerHTML = '<p id="a">Um.</p>'
    expect(htmlToLessonText('<p>fica</p><img src="x" onerror="window.__glosanoFired = true">')).toBe('fica')
    expect(nodesToLessonText([document.getElementById('a')!])).toBe('Um.')
    expect(create).not.toHaveBeenCalled()
  })
})
