import type { MockInstance } from 'vitest'
import { errorMessage } from '../errors'
import type { ImportResult, ImportTextRequest } from '../messages'
import { OVERLAY_HOST_ID } from './overlay'
import { startPickerSession, type PickerParams } from './session'

const LONG = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(12)
const SOURCE = { url: 'https://a.b/c', author: null, site_name: null }
const ARTICLE: PickerParams = { mode: 'article', title: 'T', language_code: 'pt', source: SOURCE }
const BLOCKS: PickerParams = { ...ARTICLE, mode: 'blocks' }
const OK: ImportResult = { ok: true, lessonId: 'L1', lessonUrl: 'https://g/learn/pt/lessons/L1' }

// The overlay's shadow root is closed; capture it where it is created.
let attachShadow: MockInstance<Element['attachShadow']>
beforeEach(() => {
  attachShadow = vi.spyOn(Element.prototype, 'attachShadow')
})
const shadow = () => (attachShadow.mock.results.at(-1)?.value as ShadowRoot | undefined) ?? null
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
const flush = () => new Promise((r) => setTimeout(r, 0))

type ImportText = (request: ImportTextRequest) => Promise<ImportResult>

// jsdom-dispatched events are untrusted; the tests stand in for real user input.
function deps(result: ImportResult = OK) {
  return {
    importText: vi.fn<ImportText>(async () => result),
    openUrl: vi.fn(),
    isVisible: () => true,
    isTrustedEvent: () => true,
  }
}

let cleanup: (() => void) | null = null
afterEach(() => {
  attachShadow.mockRestore()
  cleanup?.()
  cleanup = null
  document.body.innerHTML = ''
})

describe('article mode', () => {
  beforeEach(() => {
    document.body.innerHTML = `<nav>menu menu</nav><div id="content"><h1>Título</h1>${Array.from({ length: 6 }, (_, i) => `<p id="p${i}">${LONG}</p>`).join('')}</div><footer>rodapé</footer>`
  })

  it('imports the framed article on Enter', async () => {
    const d = deps()
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    await flush()
    const request = d.importText.mock.calls[0]![0]
    expect(request).toMatchObject({ title: 'T', language_code: 'pt', source: SOURCE })
    expect(request.text.startsWith('Título\n\nLorem ipsum')).toBe(true)
    expect(request.text).not.toContain('menu')
    expect(shadow()!.querySelector('.status')!.textContent).toBe('✓ Imported')
  })

  it('narrow then import sends only the largest child', async () => {
    const d = deps()
    cleanup = startPickerSession(document, ARTICLE, d)
    press('ArrowDown')
    press('Enter')
    await flush()
    expect(d.importText.mock.calls[0]![0].text).toBe(LONG.trim())
  })

  it('shows the error and stays open on failure', async () => {
    const d = deps({ ok: false, error: { code: 'queue_unavailable' } })
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    await flush()
    expect(shadow()!.querySelector('.status.error')!.textContent).toBe("Glosano can't start the import right now. Try again later.")
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull()
  })

  it('Escape removes the overlay and listeners', async () => {
    const d = deps()
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Escape')
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull()
    press('Enter')
    await flush()
    expect(d.importText).not.toHaveBeenCalled()
  })

  it('a second session replaces the first', async () => {
    const first = deps()
    startPickerSession(document, ARTICLE, first)
    const second = deps()
    cleanup = startPickerSession(document, ARTICLE, second)
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1)
    press('Enter')
    await flush()
    expect(first.importText).not.toHaveBeenCalled()
    expect(second.importText).toHaveBeenCalledTimes(1)
  })

  it('pagehide cleans up', () => {
    cleanup = startPickerSession(document, ARTICLE, deps())
    window.dispatchEvent(new Event('pagehide'))
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull()
  })

  it('ignores keys typed into page inputs', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="q">')
    const d = deps()
    cleanup = startPickerSession(document, ARTICLE, d)
    document.getElementById('q')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    expect(d.importText).not.toHaveBeenCalled()
  })

  it('does not import twice while a request is running', async () => {
    let resolve!: (r: ImportResult) => void
    const d = { ...deps(), importText: vi.fn<ImportText>(() => new Promise<ImportResult>((r) => (resolve = r))) }
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    press('Enter')
    resolve(OK)
    await flush()
    expect(d.importText).toHaveBeenCalledTimes(1)
  })

  it('recovers when the background call rejects', async () => {
    const d = deps()
    d.importText.mockRejectedValueOnce(new Error('Extension context invalidated.'))
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    await flush()
    expect(shadow()!.querySelector('.status.error')!.textContent).toBe(
      errorMessage({ code: 'unknown', detail: 'Error: Extension context invalidated.' }),
    )
    expect(shadow()!.querySelector<HTMLButtonElement>('[data-action=import]')!.disabled).toBe(false)
    press('Enter')
    await flush()
    expect(d.importText).toHaveBeenCalledTimes(2)
    expect(shadow()!.querySelector('.status')!.textContent).toBe('✓ Imported')
  })

  it('does not import again after a successful import', async () => {
    const d = deps()
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    await flush()
    expect(shadow()!.querySelector('.status')!.textContent).toBe('✓ Imported')
    const framed = () => Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => el.style.outline.includes('#2563eb'))
    const before = framed()
    press('Enter')
    press('ArrowUp')
    await flush()
    expect(d.importText).toHaveBeenCalledTimes(1)
    expect(framed()).toEqual(before)
    expect(shadow()!.querySelector('.status')!.textContent).toBe('✓ Imported')
    press('Escape')
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull()
  })

  it('ignores untrusted (page-synthesized) key events by default', async () => {
    const d = { ...deps(), isTrustedEvent: undefined }
    cleanup = startPickerSession(document, ARTICLE, d)
    press('Enter')
    press('Escape')
    await flush()
    expect(d.importText).not.toHaveBeenCalled()
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull()
  })

  it('passes the popup tags on to the import', async () => {
    const d = deps()
    cleanup = startPickerSession(document, { ...ARTICLE, tags: ['news'] }, d)
    press('Enter')
    await flush()
    expect(d.importText.mock.calls[0]![0].tags).toEqual(['news'])
  })
})

describe('blocks mode', () => {
  it('imports clicked blocks in document order', async () => {
    document.body.innerHTML = '<p id="a">Um.</p><p id="b">Dois.</p><p id="c">Três.</p>'
    const d = deps()
    cleanup = startPickerSession(document, BLOCKS, d)
    document.getElementById('c')!.click()
    document.getElementById('a')!.click()
    expect(shadow()!.querySelector('[data-role=count]')!.textContent).toBe('Selected: 2')
    press('Enter')
    await flush()
    expect(d.importText.mock.calls[0]![0].text).toBe('Um.\n\nTrês.')
  })

  it('Enter with nothing selected does nothing', async () => {
    document.body.innerHTML = '<p>Um.</p>'
    const d = deps()
    cleanup = startPickerSession(document, BLOCKS, d)
    press('Enter')
    await flush()
    expect(d.importText).not.toHaveBeenCalled()
  })

  it('reports empty text without sending', async () => {
    document.body.innerHTML = '<div id="w"><figure id="f"><img src="x.png"></figure></div>'
    const d = deps()
    cleanup = startPickerSession(document, BLOCKS, d)
    document.getElementById('f')!.click()
    press('Enter')
    await flush()
    expect(d.importText).not.toHaveBeenCalled()
    expect(shadow()!.querySelector('.status.error')!.textContent).toBe('Nothing to import.')
  })

  it('stops intercepting page clicks after a successful import', async () => {
    document.body.innerHTML = '<p id="a">Um.</p><p id="b">Dois.</p>'
    const d = deps()
    cleanup = startPickerSession(document, BLOCKS, d)
    document.getElementById('a')!.click()
    press('Enter')
    await flush()
    expect(d.importText).toHaveBeenCalledTimes(1)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('b')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(document.getElementById('b')!.style.outline).toBe('')
    press('Enter')
    await flush()
    expect(d.importText).toHaveBeenCalledTimes(1)
  })
})

it('open-lesson button calls openUrl', async () => {
  document.body.innerHTML = `<main><p>${LONG}</p></main>`
  const d = deps()
  cleanup = startPickerSession(document, ARTICLE, d)
  press('Enter')
  await flush()
  shadow()!.querySelector<HTMLButtonElement>('[data-action=open]')!.click()
  expect(d.openUrl).toHaveBeenCalledWith('https://g/learn/pt/lessons/L1')
})
