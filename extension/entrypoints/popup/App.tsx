import { useEffect, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { t } from '../../lib/i18n'
import { requestStatus, type Status } from '../../lib/messages'
import type { PageInfo } from '../../lib/page-info'
import { getSettings } from '../../lib/settings'
import { getActiveTab, readPageInfo, type ActiveTab } from '../../lib/tab-ops'
import { youtubeWatchUrl } from '../../lib/youtube'
import { ImportForm } from './ImportForm'
import { StatusView } from './StatusView'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'status'; status: Exclude<Status, { status: 'ready' }> }
  | { kind: 'restricted' }
  | { kind: 'no_languages' }
  | { kind: 'form'; status: Extract<Status, { status: 'ready' }>; tab: ActiveTab; page: PageInfo | null; youtubeUrl: string | null; openAfterImport: boolean }

async function load(): Promise<State> {
  const status = await requestStatus()
  if (status.status !== 'ready') return { kind: 'status', status }
  if (status.me.learning_languages.length === 0) return { kind: 'no_languages' }
  const tab = await getActiveTab()
  if (!tab) return { kind: 'restricted' }
  const youtubeUrl = youtubeWatchUrl(tab.url)
  const page = youtubeUrl ? null : await readPageInfo(tab.id)
  if (!youtubeUrl && !page) return { kind: 'restricted' }
  const { openAfterImport } = await getSettings()
  return { kind: 'form', status, tab, page, youtubeUrl, openAfterImport }
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    void load()
      .then(setState)
      .catch((error: unknown) => setState({ kind: 'error', message: errorMessage({ code: 'unknown', detail: String(error) }) }))
  }, [])

  return (
    <main className="p-4 font-sans text-sm text-slate-900">
      {state.kind === 'loading' && <p>{t('popup_loading')}</p>}
      {state.kind === 'error' && <p>{state.message}</p>}
      {state.kind === 'status' && <StatusView status={state.status} />}
      {state.kind === 'restricted' && <p>{errorMessage({ code: 'restricted_page' })}</p>}
      {state.kind === 'no_languages' && <p>{t('popup_no_languages')}</p>}
      {state.kind === 'form' && (
        <ImportForm me={state.status.me} tab={state.tab} page={state.page} youtubeUrl={state.youtubeUrl} openAfterImport={state.openAfterImport} />
      )}
    </main>
  )
}
