import { browser } from 'wxt/browser'

type Messages = typeof import('../public/_locales/en/messages.json')
export type MessageKey = Exclude<keyof Messages, 'extName' | 'extDescription'>

type GetMessage = (key: string, substitutions?: string | string[]) => string

export function t(key: MessageKey, substitutions?: string | string[]): string {
  const text = (browser.i18n.getMessage as unknown as GetMessage)(key, substitutions)
  return text || key
}
