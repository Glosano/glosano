import { browser } from 'wxt/browser'
import { PAGE_INFO_GLOBAL, type PageInfo } from './page-info'
import { PICKER_PARAMS_GLOBAL, type PickerParams } from './picker/session'

export interface ActiveTab {
  id: number
  url: string
  title: string
}

export async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return null
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' }
}

export async function readPageInfo(tabId: number): Promise<PageInfo | null> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/page-info.js'] })
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: (key: string) => (window as unknown as Record<string, unknown>)[key],
      args: [PAGE_INFO_GLOBAL],
    })
    return (result?.result as PageInfo | undefined) ?? null
  } catch {
    // chrome://, about:, extension stores, the PDF viewer and similar pages refuse injection.
    return null
  }
}

export async function startPicker(tabId: number, params: PickerParams): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (key: string, value: PickerParams) => {
        ;(window as unknown as Record<string, unknown>)[key] = value
      },
      args: [PICKER_PARAMS_GLOBAL, params],
    })
    await browser.scripting.executeScript({ target: { tabId }, files: ['/picker.js'] })
    return true
  } catch {
    return false
  }
}
