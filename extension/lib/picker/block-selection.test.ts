import { findBlockCandidate, sortByDocumentOrder, toggleBlock } from './block-selection'

// jsdom has no layout: getBoundingClientRect() is all zeros, so tests inject
// a stub visibility check.
const visible = () => true

describe('findBlockCandidate', () => {
  test('climbs from an inline element to the nearest block', () => {
    document.body.innerHTML = `<p id="p"><span id="s">text</span></p>`
    const found = findBlockCandidate(document.getElementById('s'), document.body, visible)
    expect(found!.id).toBe('p')
  })

  test('returns the element itself when it is a block', () => {
    document.body.innerHTML = `<h2 id="h">heading</h2>`
    const found = findBlockCandidate(document.getElementById('h'), document.body, visible)
    expect(found!.id).toBe('h')
  })

  test('skips empty wrappers and climbs to a block with content', () => {
    document.body.innerHTML = `<div id="outer"><div id="empty">   </div></div>`
    const found = findBlockCandidate(document.getElementById('empty'), document.body, visible)
    expect(found).toBeNull()
  })

  test('accepts images without text content', () => {
    document.body.innerHTML = `<img id="i" src="x.png">`
    const found = findBlockCandidate(document.getElementById('i'), document.body, visible)
    expect(found!.id).toBe('i')
  })

  test('never returns body', () => {
    document.body.innerHTML = 'text node only'
    const found = findBlockCandidate(document.body, document.body, visible)
    expect(found).toBeNull()
  })
})

describe('toggleBlock', () => {
  test('adds and removes an element', () => {
    document.body.innerHTML = `<p id="p">text</p>`
    const p = document.getElementById('p')!
    const selected = new Set<Element>()
    toggleBlock(selected, p)
    expect(selected.has(p)).toBe(true)
    toggleBlock(selected, p)
    expect(selected.size).toBe(0)
  })

  test('ignores a descendant of an already selected block', () => {
    document.body.innerHTML = `<div id="outer"><p id="inner">text</p></div>`
    const outer = document.getElementById('outer')!
    const inner = document.getElementById('inner')!
    const selected = new Set<Element>([outer])
    toggleBlock(selected, inner)
    expect(selected.size).toBe(1)
    expect(selected.has(outer)).toBe(true)
  })

  test('an ancestor absorbs selected descendants', () => {
    document.body.innerHTML = `<div id="outer"><p id="a">a</p><p id="b">b</p></div>`
    const outer = document.getElementById('outer')!
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const selected = new Set<Element>([a, b])
    toggleBlock(selected, outer)
    expect(selected.size).toBe(1)
    expect(selected.has(outer)).toBe(true)
  })
})

describe('sortByDocumentOrder', () => {
  test('sorts elements by their position in the document', () => {
    document.body.innerHTML = `<p id="a">a</p><p id="b">b</p><p id="c">c</p>`
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const c = document.getElementById('c')!
    expect(sortByDocumentOrder(new Set([c, a, b]))).toEqual([a, b, c])
  })
})
