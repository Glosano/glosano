import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'
import { collectPageInfo, PAGE_INFO_GLOBAL } from '../lib/page-info'

// Injected on demand by the popup; the result is read back with a second executeScript call.
export default defineUnlistedScript(() => {
  ;(window as unknown as Record<string, unknown>)[PAGE_INFO_GLOBAL] = collectPageInfo(document)
})
