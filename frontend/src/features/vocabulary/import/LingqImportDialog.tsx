import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Tabs } from 'radix-ui'

import { ApiError, getApiErrorMessage } from '@/api/client'
import { vocabularyImportApi, type ImportIssue, type ImportJob } from '@/api/vocabularyImport'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { msg, useI18n, type Translator } from '@/lib/i18n'
import { useImportJobsStore } from '@/stores/importJobsStore'
import { rememberImportJob, useActiveImport, useImportJob } from './useImportJob'

interface Props {
  lang: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const LINGQ_API_KEY_URL = 'https://www.lingq.com/en/accounts/apikey/'

const INTERRUPTED = msg('The import was interrupted. Start it again — nothing will be duplicated.')
const FAILED = msg('The import failed. Try again later.')
const NOT_FOUND = msg('The import was not found.')
const LOST = msg('Lost connection to the server — the import status is unknown.')

/** Error codes from a start request's `detail` or a finished job's `error_code`. */
const ERROR_MESSAGES: Record<string, string> = {
  import_already_running: msg('An import is already running.'),
  native_language_required: msg('Set your native language in the profile first.'),
  csv_not_utf8: msg('The file is not a UTF-8 CSV.'),
  csv_missing_term_column: msg(
    'This does not look like a LingQ export: there is no "term" column.',
  ),
  csv_malformed: msg('The file looks damaged or is not a CSV export.'),
  csv_too_many_rows: msg('The file has too many rows.'),
  csv_too_large: msg('The file is too large.'),
  invalid_confidence: msg('Choose a level for new words.'),
  import_not_found: NOT_FOUND,
  lingq_unauthorized: msg('LingQ rejected the key. Check it and try again.'),
  lingq_unavailable: msg('LingQ is unreachable from the server. Try again later.'),
  lingq_rejected: msg('LingQ did not accept the request. Check the selected language.'),
  lingq_too_many_cards: msg('You have too many LingQ cards in this language to import by token.'),
  internal_error: FAILED,
  server_restarted: INTERRUPTED,
  server_stopped: INTERRUPTED,
}

const ISSUE_MESSAGES: Record<string, string> = {
  empty_term: msg('Empty term'),
  phrase_too_long: msg('Phrase is longer than 8 words'),
  term_too_long: msg('Term is longer than 256 characters'),
  translation_language_unsupported: msg('Translation skipped: language not supported'),
  translation_too_long: msg('Translation is longer than 512 characters'),
  tag_too_long: msg('Tag is longer than 64 characters'),
  note_too_long: msg('Note is longer than 4000 characters'),
}
const ISSUE_FALLBACK = msg('This row was skipped.')

function startErrorMessage(t: Translator, error: unknown): string {
  if (typeof error === 'string') return t(error)
  const key = error instanceof ApiError ? ERROR_MESSAGES[error.detail] : undefined
  return key ? t(key) : getApiErrorMessage(error)
}

function jobErrorMessage(t: Translator, job: ImportJob): string {
  if (job.status === 'interrupted') return t(INTERRUPTED)
  return t((job.error_code && ERROR_MESSAGES[job.error_code]) || FAILED)
}

/**
 * LingQ vocabulary import (FLQ-14). The job it shows is handed to the app-level
 * `ImportJobsWatcher`, which polls it and refreshes the vocabulary when it ends even after this
 * dialog and its page unmount; the form (and the typed key) lives only in the dialog content,
 * which unmounts on close.
 */
export function LingqImportDialog({ lang, open, onOpenChange }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const watch = useImportJobsStore((state) => state.watch)
  const [startedJobId, setStartedJobId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const active = useActiveImport(lang, open)
  const activeId = active.data?.id ?? null
  const jobId = startedJobId ?? (activeId !== null && !dismissed.has(activeId) ? activeId : null)
  const jobQuery = useImportJob(jobId)
  const job = jobQuery.data
  // Fetching the job keeps failing. A 404 means the job is gone; anything else (network, 5xx)
  // leaves its state unknown, so it must not be dismissed: it may still be running.
  const gone =
    jobId !== null &&
    jobQuery.isError &&
    jobQuery.error instanceof ApiError &&
    jobQuery.error.status === 404
  const lost = jobId !== null && jobQuery.isError && !gone

  useEffect(() => {
    if (jobId !== null) watch(jobId)
  }, [jobId, watch])

  function onStarted(started: ImportJob) {
    rememberImportJob(qc, started)
    setStartedJobId(started.id)
  }
  function startOver() {
    if (jobId !== null) setDismissed((ids) => new Set(ids).add(jobId))
    setStartedJobId(null)
  }

  // Only a job seen ended (or gone) may be dismissed for a new import.
  const finished = gone || (!lost && job !== undefined && job.status !== 'running')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('Import from LingQ')}</DialogTitle>
          <DialogDescription>
            {t('Words and phrases go to your {{language}} vocabulary.', {
              language: lang.toUpperCase(),
            })}
          </DialogDescription>
        </DialogHeader>
        {jobId === null ? (
          active.isPending ? (
            <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
          ) : (
            <ImportForms
              lang={lang}
              onStarted={onStarted}
              onAlreadyRunning={() => void active.refetch()}
            />
          )
        ) : lost ? (
          <p role="alert" className="text-sm text-destructive">
            {t(LOST)}
          </p>
        ) : gone ? (
          <p role="alert" className="text-sm text-destructive">
            {t(NOT_FOUND)}
          </p>
        ) : job === undefined ? (
          <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
        ) : job.status === 'running' ? (
          <ImportProgress job={job} />
        ) : (
          <ImportReport job={job} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('Close')}
          </Button>
          {lost && (
            <Button
              type="button"
              disabled={jobQuery.isFetching}
              onClick={() => void jobQuery.refetch()}
            >
              {t('Check again')}
            </Button>
          )}
          {finished && (
            <Button type="button" onClick={startOver}>
              {!gone && job?.status === 'done' ? t('New import') : t('Try again')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FormsProps {
  lang: string
  onStarted: (job: ImportJob) => void
  onAlreadyRunning: () => void
}

function ImportForms({ lang, onStarted, onAlreadyRunning }: FormsProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState('token')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function start(request: () => Promise<ImportJob>) {
    setPending(true)
    setError(null)
    try {
      onStarted(await request())
    } catch (err) {
      setError(err)
      if (err instanceof ApiError && err.detail === 'import_already_running') onAlreadyRunning()
    } finally {
      setPending(false)
    }
  }

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => {
        setTab(value)
        setError(null)
      }}
    >
      <Tabs.List aria-label={t('Import method')} className="mb-4 flex rounded-lg bg-muted p-1">
        {[
          ['token', msg('By token (with levels)')],
          ['csv', msg('CSV file')],
        ].map(([value, label]) => (
          <Tabs.Trigger
            key={value}
            value={value!}
            disabled={pending}
            className="flex-1 rounded-md px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm disabled:opacity-50"
          >
            {t(label!)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="token">
        <TokenForm lang={lang} pending={pending} onError={setError} start={start} />
      </Tabs.Content>
      <Tabs.Content value="csv">
        <CsvForm lang={lang} pending={pending} onError={setError} start={start} />
      </Tabs.Content>
      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {startErrorMessage(t, error)}
        </p>
      )}
    </Tabs.Root>
  )
}

interface FormProps {
  lang: string
  pending: boolean
  onError: (error: unknown) => void
  start: (request: () => Promise<ImportJob>) => Promise<void>
}

function TagsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n()
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id}>{t('Import LingQ tags')}</Label>
    </div>
  )
}

function TokenForm({ lang, pending, onError, start }: FormProps) {
  const { t } = useI18n()
  const keyId = useId()
  // The key lives only here, in memory: never in a query key, URL, storage or log.
  const [token, setToken] = useState('')
  const [conflictMode, setConflictMode] = useState<'keep' | 'update'>('keep')
  const [importTags, setImportTags] = useState(true)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const value = token.trim()
    setToken('')
    if (!value) {
      onError(msg('Paste your LingQ API key.'))
      return
    }
    void start(() =>
      vocabularyImportApi.startLingq(lang, { token: value, conflictMode, importTags }),
    )
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          <a
            href={LINGQ_API_KEY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {t('Sign in to LingQ and open the API key page')}
          </a>
        </li>
        <li>
          <Label htmlFor={keyId} className="font-normal">
            {t('Copy the key and paste it here')}
          </Label>
        </li>
      </ol>
      <div className="space-y-1">
        <Input
          id={keyId}
          // Plain text masked with CSS, so password managers do not offer to save the key.
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="[-webkit-text-security:disc]"
          aria-label={t('LingQ API key')}
          value={token}
          disabled={pending}
          onChange={(event) => setToken(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          {t('The key is used only for this import and is not saved.')}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'Words you marked as known while reading in LingQ are not transferred yet — only your LingQ cards.',
        )}
      </p>
      <fieldset className="space-y-2" disabled={pending}>
        <legend className="mb-1 text-sm font-medium">
          {t('If a word is already in your vocabulary')}
        </legend>
        {(
          [
            ['keep', msg('Keep its level')],
            ['update', msg('Update from LingQ')],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="lingq-conflict-mode"
              value={value}
              checked={conflictMode === value}
              onChange={() => setConflictMode(value)}
            />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <TagsCheckbox checked={importTags} onChange={setImportTags} />
      <Button type="submit" disabled={pending}>
        {t('Start import')}
      </Button>
    </form>
  )
}

const LEVELS = [
  'tracked:0',
  'tracked:1',
  'tracked:2',
  'tracked:3',
  'tracked:4',
  'tracked:5',
  'known',
]

function CsvForm({ lang, pending, onError, start }: FormProps) {
  const { t } = useI18n()
  const fileId = useId()
  const levelId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [level, setLevel] = useState('tracked:1')
  const [importTags, setImportTags] = useState(true)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!file) {
      onError(msg('Choose a CSV file.'))
      return
    }
    const [status, confidence] = level.split(':') as ['tracked' | 'known', string | undefined]
    void start(() =>
      vocabularyImportApi.startCsv(lang, file, {
        status,
        confidence: confidence === undefined ? null : Number(confidence),
        importTags,
      }),
    )
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {t(
          'A CSV export has no levels, review dates or known words. To transfer levels and review dates, use the token tab.',
        )}
      </p>
      <div className="space-y-2">
        <Label htmlFor={fileId}>{t('Choose file')}</Label>
        <Input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={levelId}>{t('Level for new words')}</Label>
        <Select value={level} onValueChange={setLevel} disabled={pending}>
          <SelectTrigger id={levelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((value) => (
              <SelectItem key={value} value={value}>
                {value === 'known'
                  ? t('Known')
                  : t('Studying, confidence {{value}}', { value: value.split(':')[1]! })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TagsCheckbox checked={importTags} onChange={setImportTags} />
      <Button type="submit" disabled={pending}>
        {t('Start import')}
      </Button>
    </form>
  )
}

function ImportProgress({ job }: { job: ImportJob }) {
  const { t } = useI18n()
  const share = job.total ? Math.min(100, (job.processed / job.total) * 100) : 0
  return (
    <div role="status" className="space-y-3">
      <p className="text-sm">
        {job.total === null
          ? t('Importing…')
          : t('Importing… {{done}} of {{total}}', { done: job.processed, total: job.total })}
      </p>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${share}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('You can close this window — the import will continue.')}
      </p>
    </div>
  )
}

function issueText(t: Translator, issue: ImportIssue): string {
  const message = t(ISSUE_MESSAGES[issue.code] ?? ISSUE_FALLBACK)
  const where = [issue.row !== null ? t('Row {{row}}', { row: issue.row }) : null, issue.term]
    .filter(Boolean)
    .join(' · ')
  return where ? `${where} — ${message}` : message
}

function ImportReport({ job }: { job: ImportJob }) {
  const { t } = useI18n()
  const failed = job.status !== 'done'
  return (
    <div className="space-y-3 text-sm">
      {failed ? (
        <p role="alert" className="text-destructive">
          {jobErrorMessage(t, job)}
        </p>
      ) : (
        <p className="font-medium">{t('Import finished')}</p>
      )}
      {(!failed || job.processed > 0) && (
        <ul className="space-y-1">
          <li>
            {t('Added: {{words}} words, {{phrases}} phrases', {
              words: job.created_tokens,
              phrases: job.created_phrases,
            })}
          </li>
          <li>{t('Updated: {{value}}', { value: job.updated_items })}</li>
          <li>{t('New known words: {{value}}', { value: job.known_words })}</li>
          <li>{t('Skipped: {{value}}', { value: job.skipped })}</li>
        </ul>
      )}
      {job.issues.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">{t('Show details')}</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {job.issues.map((issue, index) => (
              <li key={index}>{issueText(t, issue)}</li>
            ))}
          </ul>
          {job.issues_dropped > 0 && (
            <p className="mt-1 text-muted-foreground">
              {t('and {{value}} more not shown', { value: job.issues_dropped })}
            </p>
          )}
        </details>
      )}
    </div>
  )
}
