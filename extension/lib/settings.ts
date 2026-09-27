import { browser } from 'wxt/browser'

export interface Settings {
  instanceOrigin: string | null
  openAfterImport: boolean
}

export function normalizeOrigin(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.origin
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(['instanceOrigin', 'openAfterImport'])
  return {
    instanceOrigin: typeof stored.instanceOrigin === 'string' ? stored.instanceOrigin : null,
    openAfterImport: typeof stored.openAfterImport === 'boolean' ? stored.openAfterImport : true,
  }
}

export async function saveInstanceOrigin(origin: string): Promise<void> {
  await browser.storage.local.set({ instanceOrigin: origin })
}

export async function setOpenAfterImport(value: boolean): Promise<void> {
  await browser.storage.local.set({ openAfterImport: value })
}
