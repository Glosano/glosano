import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'
import { requestImportText, requestOpenUrl } from '../lib/messages'
import { PICKER_PARAMS_GLOBAL, startPickerSession, type PickerParams } from '../lib/picker/session'

// The popup stores PickerParams on window right before injecting this file.
export default defineUnlistedScript(() => {
  const params = (window as unknown as Record<string, unknown>)[PICKER_PARAMS_GLOBAL] as PickerParams | undefined
  if (!params) return
  startPickerSession(document, params, {
    importText: requestImportText,
    openUrl: (url) => void requestOpenUrl(url),
  })
})
