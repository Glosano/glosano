import { useRef, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import type { Me } from '../../lib/glosano-client'
import { t } from '../../lib/i18n'
import { languageLabel, pickDefaultLanguage } from '../../lib/languages'
import { requestImportText, requestImportYoutube, requestOpenUrl, type ImportResult } from '../../lib/messages'
import type { PageInfo } from '../../lib/page-info'
import { setOpenAfterImport } from '../../lib/settings'
import { startPicker, type ActiveTab } from '../../lib/tab-ops'
import { truncateCodePoints } from '../../lib/text'

export type Mode = 'youtube' | 'selection' | 'article' | 'blocks'

interface Props {
  me: Me
  tab: ActiveTab
  page: PageInfo | null
  youtubeUrl: string | null
  openAfterImport: boolean
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

export function ImportForm({ me, tab, page, youtubeUrl, openAfterImport }: Props) {
  const modes: Mode[] = youtubeUrl ? ['youtube'] : ['article', 'blocks', 'selection']
  const [mode, setMode] = useState<Mode>(youtubeUrl ? 'youtube' : page?.selection ? 'selection' : 'article')
  const [title, setTitle] = useState(truncateCodePoints(page?.title || tab.title.replace(/ - YouTube$/, ''), 200))
  const [language, setLanguage] = useState(pickDefaultLanguage(page?.lang ?? null, me.learning_languages, me.last_learning_language_code) ?? '')
  const [openAfter, setOpenAfter] = useState(openAfterImport)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  // A plain ref, not state: two clicks dispatched before React commits the first
  // setBusy(true) would otherwise both read the same stale `busy === false` closure.
  const busyRef = useRef(false)

  const source = { url: page?.url ?? tab.url, author: page?.byline ?? null, site_name: page?.siteName ?? null }
  const modeLabel: Record<Mode, string> = {
    youtube: t('popup_mode_youtube'),
    selection: t('popup_mode_selection'),
    article: t('popup_mode_article'),
    blocks: t('popup_mode_blocks'),
  }
  const hint: Record<Mode, string> = {
    youtube: t('popup_hint_youtube'),
    selection: t('popup_selection_words', String(wordCount(page?.selection ?? ''))),
    article: t('popup_hint_article'),
    blocks: t('popup_hint_blocks'),
  }

  async function onImport() {
    if (busyRef.current) return
    busyRef.current = true
    setResult(null)
    setBusy(true)
    try {
      if (mode === 'article' || mode === 'blocks') {
        const started = await startPicker(tab.id, { mode, title, language_code: language, source })
        if (started) {
          window.close()
          return
        }
        setResult({ ok: false, error: { code: 'restricted_page' } })
        return
      }
      const outcome =
        mode === 'youtube'
          ? await requestImportYoutube({ url: youtubeUrl!, language_code: language })
          : await requestImportText({ title, language_code: language, text: page?.selection ?? '', source })
      setResult(outcome)
      if (outcome.ok && openAfter) window.close()
    } catch (error) {
      setResult({ ok: false, error: { code: 'unknown', detail: String(error) } })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-3">
        <p>{t('popup_imported')}</p>
        <button
          type="button"
          onClick={() => void requestOpenUrl(result.lessonUrl)}
          className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
        >
          {t('popup_open_lesson')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void onImport()
      }}
    >
      <fieldset className="flex gap-1">
        {modes.map((m) => (
          <label key={m} className="flex-1">
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              disabled={m === 'selection' && !page?.selection}
              onChange={() => setMode(m)}
              className="peer sr-only"
            />
            <span className="block cursor-pointer rounded border border-slate-300 px-2 py-1 text-center peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-disabled:cursor-default peer-disabled:opacity-40">
              {modeLabel[m]}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-slate-600">{hint[mode]}</p>
      {mode !== 'youtube' && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t('popup_title_label')}</span>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('popup_language_label')}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
          {me.learning_languages.map((code) => (
            <option key={code} value={code}>
              {languageLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={openAfter}
          onChange={(e) => {
            setOpenAfter(e.target.checked)
            void setOpenAfterImport(e.target.checked)
          }}
        />
        <span>{t('popup_open_after')}</span>
      </label>
      {result && !result.ok && (
        <p role="alert" className="text-red-700">
          {errorMessage(result.error)}
        </p>
      )}
      <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? t('popup_importing') : mode === 'article' || mode === 'blocks' ? t('popup_pick_on_page') : t('popup_import')}
      </button>
    </form>
  )
}
