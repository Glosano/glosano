import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import messages from '../public/_locales/en/messages.json'

type Catalog = Record<string, { message: string }>

// fakeBrowser does not implement i18n; serve the real English catalog so tests see real copy.
function getMessage(key: string, substitutions?: string | string[]): string {
  const entry = (messages as Catalog)[key]
  if (!entry) return ''
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions]
  return entry.message.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '')
}

beforeEach(() => {
  fakeBrowser.reset()
  fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage
})
