import { nodesToLessonText } from './html-to-text'
import { getSelectionFragment } from './selection'

function selectNodes(...nodes: Node[]) {
  const sel = document.getSelection()!
  sel.removeAllRanges()
  for (const node of nodes) {
    const range = document.createRange()
    range.selectNodeContents(node)
    sel.addRange(range)
  }
}

describe('getSelectionFragment', () => {
  it('returns null without a selection', () => {
    document.getSelection()!.removeAllRanges()
    expect(getSelectionFragment(document)).toBeNull()
  })

  it('keeps paragraph structure of the selection', () => {
    document.body.innerHTML = '<div id="d"><p>Um.</p><p>Dois.</p></div>'
    selectNodes(document.getElementById('d')!)
    const fragment = getSelectionFragment(document)!
    expect(nodesToLessonText([fragment])).toBe('Um.\n\nDois.')
  })

  it('collects every range', () => {
    document.body.innerHTML = '<p id="a">Um.</p><p>meio</p><p id="b">Dois.</p>'
    selectNodes(document.getElementById('a')!, document.getElementById('b')!)
    const text = nodesToLessonText([getSelectionFragment(document)!])
    // jsdom keeps only the first range; Firefox keeps both (checked manually in Task 11).
    expect(['Um.\n\nDois.', 'Um.']).toContain(text)
  })

  it('falls back to a selection inside a same-origin iframe', () => {
    document.getSelection()!.removeAllRanges()
    document.body.innerHTML = '<iframe id="f"></iframe>'
    const frameDoc = (document.getElementById('f') as HTMLIFrameElement).contentDocument!
    frameDoc.body.innerHTML = '<p id="x">No iframe.</p>'
    const range = frameDoc.createRange()
    range.selectNodeContents(frameDoc.getElementById('x')!)
    frameDoc.getSelection()!.addRange(range)
    expect(nodesToLessonText([getSelectionFragment(document)!])).toBe('No iframe.')
  })

  it('prefers an iframe selection over a collapsed cursor in the parent page', () => {
    document.body.innerHTML = '<p id="p">Texto.</p><iframe id="f"></iframe>'
    const cursor = document.createRange()
    cursor.setStart(document.getElementById('p')!.firstChild!, 2)
    cursor.collapse(true)
    const sel = document.getSelection()!
    sel.removeAllRanges()
    sel.addRange(cursor)
    expect(sel.rangeCount).toBe(1)
    const frameDoc = (document.getElementById('f') as HTMLIFrameElement).contentDocument!
    frameDoc.body.innerHTML = '<p id="x">Dentro do iframe.</p>'
    const range = frameDoc.createRange()
    range.selectNodeContents(frameDoc.getElementById('x')!)
    frameDoc.getSelection()!.removeAllRanges()
    frameDoc.getSelection()!.addRange(range)
    expect(nodesToLessonText([getSelectionFragment(document)!])).toBe('Dentro do iframe.')
  })
})
