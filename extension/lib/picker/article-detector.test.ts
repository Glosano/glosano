import { detectArticleNode, expandNode, narrowNode } from './article-detector'

const LONG =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. '.repeat(10)

describe('detectArticleNode', () => {
  test('parses the Readability output in an inert document, not the live one', () => {
    document.body.innerHTML = `<div id="content">${Array.from({ length: 8 }, (_, i) => `<p id="p${i}">${LONG}<img src="x.png"></p>`).join('')}</div>`
    const create = vi.spyOn(document, 'createElement')
    const node = detectArticleNode(document)
    expect(node.contains(document.getElementById('p0'))).toBe(true)
    expect(create).not.toHaveBeenCalled()
    create.mockRestore()
  })

  test('finds the content container on an article-like page', () => {
    document.body.innerHTML = `
      <nav id="nav">menu menu menu</nav>
      <div id="content">
        <h1>Title</h1>
        ${Array.from({ length: 8 }, (_, i) => `<p id="p${i}">${LONG}</p>`).join('')}
      </div>
      <footer id="footer">footer</footer>`

    const node = detectArticleNode(document)

    expect(node.contains(document.getElementById('p0'))).toBe(true)
    expect(node.contains(document.getElementById('p7'))).toBe(true)
    expect(node.contains(document.getElementById('nav'))).toBe(false)
  })

  test('falls back to <main> when the page has no readable article', () => {
    document.body.innerHTML = `<main id="m"><p>short</p></main>`
    expect(detectArticleNode(document).id).toBe('m')
  })

  test('falls back to body on an empty page', () => {
    document.body.innerHTML = ''
    expect(detectArticleNode(document)).toBe(document.body)
  })

  test('cleans up temporary attributes', () => {
    document.body.innerHTML = `<main><p>short</p></main>`
    detectArticleNode(document)
    expect(document.querySelector('[data-glosano-id]')).toBeNull()
  })

  test('falls back to documentElement without throwing when there is no <body>', () => {
    document.body.innerHTML = `<p>short</p>`
    const body = document.body
    body.remove()
    try {
      expect(document.body).toBeNull()
      let node: Element | undefined
      expect(() => {
        node = detectArticleNode(document)
      }).not.toThrow()
      expect(node).toBe(document.documentElement)
    } finally {
      // Restore <body> so later tests in this file keep a working document.body.
      document.documentElement.appendChild(body)
    }
  })
})

describe('expandNode / narrowNode', () => {
  test('expandNode returns the parent and stops at body', () => {
    document.body.innerHTML = `<div id="outer"><p id="inner">text</p></div>`
    const inner = document.getElementById('inner')!
    expect(expandNode(inner).id).toBe('outer')
    expect(expandNode(document.body)).toBe(document.body)
  })

  test('narrowNode returns the child with the most text', () => {
    document.body.innerHTML = `
      <div id="root">
        <div id="small">tiny</div>
        <div id="big">${LONG}</div>
      </div>`
    expect(narrowNode(document.getElementById('root')!).id).toBe('big')
  })

  test('narrowNode returns the node itself when there are no children', () => {
    document.body.innerHTML = `<p id="leaf">text</p>`
    const leaf = document.getElementById('leaf')!
    expect(narrowNode(leaf)).toBe(leaf)
  })
})
