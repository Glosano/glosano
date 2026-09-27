import { browser } from 'wxt/browser'
import { errorMessage } from '../../lib/errors'
import { t } from '../../lib/i18n'
import { requestOpenUrl, type Status } from '../../lib/messages'

type NotReady = Exclude<Status, { status: 'ready' }>

export function StatusView({ status }: { status: NotReady }) {
  const openSettings = () => {
    void browser.runtime.openOptionsPage()
    window.close()
  }
  // Wait for delivery: Firefox can drop the message if the popup closes first.
  const open = async (url: string) => {
    try {
      await requestOpenUrl(url)
    } catch (error) {
      console.warn('Failed to open', url, error)
    }
    window.close()
  }
  const text =
    status.status === 'unreachable'
      ? errorMessage({ code: 'unreachable', detail: status.origin })
      : errorMessage({ code: status.status })
  const action =
    status.status === 'signed_out'
      ? { label: t('popup_sign_in'), run: () => void open(`${status.origin}/login`) }
      : status.status === 'needs_onboarding'
        ? { label: t('popup_open_glosano'), run: () => void open(`${status.origin}/`) }
        : { label: t('popup_open_settings'), run: openSettings }
  return (
    <div className="flex flex-col gap-3">
      <p>{text}</p>
      <button type="button" onClick={action.run} className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700">
        {action.label}
      </button>
    </div>
  )
}
