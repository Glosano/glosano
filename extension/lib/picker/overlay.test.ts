import { PickerOverlay } from './overlay'

describe('PickerOverlay', () => {
  let overlay: PickerOverlay | null

  afterEach(() => {
    if (overlay) overlay.destroy()
    overlay = null
    document.body.innerHTML = ''
  })

  test('mounts a closed shadow host and removes it on destroy', () => {
    overlay = new PickerOverlay(document)
    const host = document.getElementById('glosano-picker-overlay')
    expect(host).not.toBeNull()
    // Closed, so page scripts cannot reach the panel buttons through host.shadowRoot.
    expect(host!.shadowRoot).toBeNull()
    expect(overlay.shadow.querySelector('.panel')).not.toBeNull()
    overlay.destroy()
    expect(document.getElementById('glosano-picker-overlay')).toBeNull()
    overlay = null
  })

  test('article panel renders expand/narrow/import/cancel and wires callbacks', () => {
    overlay = new PickerOverlay(document)
    const onImport = vi.fn()
    const onCancel = vi.fn()
    const onExpand = vi.fn()
    const onNarrow = vi.fn()
    overlay.setPanel({ mode: 'article', onExpand, onNarrow, onImport, onCancel })

    const shadow = overlay.shadow
    shadow.querySelector<HTMLButtonElement>('[data-action=expand]')!.click()
    shadow.querySelector<HTMLButtonElement>('[data-action=narrow]')!.click()
    shadow.querySelector<HTMLButtonElement>('[data-action=import]')!.click()
    shadow.querySelector<HTMLButtonElement>('[data-action=cancel]')!.click()
    expect(onExpand).toHaveBeenCalled()
    expect(onNarrow).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  test('multiple panel renders counter without expand/narrow', () => {
    overlay = new PickerOverlay(document)
    overlay.setPanel({ mode: 'blocks', onImport: () => {}, onCancel: () => {} })
    const shadow = overlay.shadow
    expect(shadow.querySelector('[data-action=expand]')).toBeNull()
    overlay.setCount(3)
    expect(shadow.querySelector('[data-role=count]')!.textContent).toBe('Selected: 3')
  })

  test('showFrame outlines the node and destroy restores the original style', () => {
    document.body.innerHTML = `<p id="p" style="outline: 1px dotted red">text</p>`
    const p = document.getElementById('p')!
    overlay = new PickerOverlay(document)
    overlay.showFrame(p)
    expect(p.style.outline).toContain('#2563eb')
    overlay.destroy()
    expect(p.style.outline).toBe('1px dotted red')
    overlay = null
  })

  test('markSelected outlines added nodes and restores removed ones', () => {
    document.body.innerHTML = `<p id="a">a</p><p id="b">b</p>`
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    overlay = new PickerOverlay(document)
    overlay.markSelected([a, b])
    expect(a.style.outline).toContain('#2563eb')
    overlay.markSelected([b])
    expect(a.style.outline).toBe('')
    expect(b.style.outline).toContain('#2563eb')
  })

  test('contains() detects the host element', () => {
    overlay = new PickerOverlay(document)
    expect(overlay.contains(document.getElementById('glosano-picker-overlay'))).toBe(true)
    expect(overlay.contains(document.body)).toBe(false)
  })

  test('showSuccess renders an open-lesson link that calls back', () => {
    overlay = new PickerOverlay(document)
    overlay.setPanel({ mode: 'article', onExpand: vi.fn(), onNarrow: vi.fn(), onImport: vi.fn(), onCancel: vi.fn() })
    const onOpen = vi.fn()
    overlay.showSuccess('https://g.example.com/learn/pt/lessons/L1', onOpen)
    const root = overlay.shadow
    expect(root.querySelector('.status')!.textContent).toBe('✓ Imported')
    const link = root.querySelector<HTMLButtonElement>('[data-action=open]')!
    expect(link.textContent).toBe('Open lesson')
    link.click()
    expect(onOpen).toHaveBeenCalledWith('https://g.example.com/learn/pt/lessons/L1')
  })

  test('showBusy disables the import button until an error re-enables it', () => {
    overlay = new PickerOverlay(document)
    overlay.setPanel({ mode: 'blocks', onImport: vi.fn(), onCancel: vi.fn() })
    const root = overlay.shadow
    const button = root.querySelector<HTMLButtonElement>('[data-action=import]')!
    overlay.showBusy()
    expect(button.disabled).toBe(true)
    expect(root.querySelector('.status')!.textContent).toBe('Importing…')
    overlay.showError('Nothing to import.')
    expect(button.disabled).toBe(false)
    expect(root.querySelector('.status.error')!.textContent).toBe('Nothing to import.')
  })

  test('a second overlay replaces a leftover host', () => {
    const first = new PickerOverlay(document)
    overlay = new PickerOverlay(document)
    expect(document.querySelectorAll('#glosano-picker-overlay')).toHaveLength(1)
    first.destroy()
  })
})
