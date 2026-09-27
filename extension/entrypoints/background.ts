import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { createHandlers, handleMessage } from '../lib/background-handlers'
import { readCsrfToken } from '../lib/csrf'
import { createGlosanoClient } from '../lib/glosano-client'
import type { BackgroundRequest } from '../lib/messages'
import { hasHostPermission } from '../lib/permissions'
import { getSettings } from '../lib/settings'

export default defineBackground(() => {
  const handlers = createHandlers({
    loadSettings: getSettings,
    hasPermission: hasHostPermission,
    makeClient: (origin) =>
      createGlosanoClient({
        origin,
        fetch: (input, init) => fetch(input, init),
        getCsrfToken: () => readCsrfToken(browser.cookies, origin),
      }),
    openTab: async (url) => {
      await browser.tabs.create({ url })
    },
    newRequestId: () => crypto.randomUUID(),
  })

  // sendResponse + `return true` keeps the channel open in both Chrome and Firefox.
  browser.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
    handleMessage(handlers, message).then(sendResponse, (error: unknown) =>
      sendResponse({ ok: false, error: { code: 'unknown', detail: String(error) } }),
    )
    return true
  })
})
