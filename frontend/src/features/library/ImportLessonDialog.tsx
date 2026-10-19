import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Tabs } from 'radix-ui'
import { Upload } from 'lucide-react'

import { lessonsApi } from '@/api/lessons'
import { ApiError, getApiErrorMessage } from '@/api/client'
import { useTranslation, msg } from '@/lib/i18n'
import { parseTagInput, tagInputError } from '@/lib/tags'
import { Button } from '@/components/ui/button'
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
import { videoImportError, VIDEO_IMPORT_ERRORS } from './videoImportErrors'
import { randomId } from '@/lib/randomId'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MAX_FILE_BYTES = 5 * 1024 * 1024
const FILE_ERRORS: Record<string, string> = {
  'unsupported lesson file': msg('Only .txt and .md files with text content are supported.'),
  'lesson file too large': msg('The file must not exceed 5 MiB.'),
  'lesson file must be UTF-8': msg('Save the file as UTF-8 and try again.'),
  'lesson file must contain text': msg('The file must contain non-empty text.'),
}

// A fresh form on every open also prevents a previous upload from closing a new dialog.
export function ImportLessonDialog(props: Props) {
  return props.open ? <ImportLessonForm {...props} /> : null
}

function ImportLessonForm({ open, onOpenChange }: Props) {
  const t = useTranslation()
  const params = useParams({ strict: false }) as { lang?: string }
  const lang = params.lang ?? 'en'
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('text')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [lessonId, setLessonId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [tagText, setTagText] = useState('')
  const requestId = useRef<string | null>(null)

  const create = useMutation({
    mutationFn: () => {
      const tags = parseTagInput(tagText)
      const withTags = tags.length > 0 ? { tags } : {}
      if (tab === 'youtube') {
        requestId.current ??= randomId()
        return lessonsApi.importYouTube({
          url: url.trim(),
          language_code: lang,
          request_id: requestId.current,
          ...withTags,
        })
      }
      return tab === 'file' && file
        ? lessonsApi.importFile(file, title.trim(), lang, tags)
        : lessonsApi.create({
            title: title.trim(),
            language_code: lang,
            raw_text: text.trim(),
            visibility: 'private',
            ...withTags,
          })
    },
    onSuccess: (lesson) => {
      setLessonId(lesson.id)
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
    },
    onError: (err: unknown) => {
      setError(err)
    },
  })
  const lesson = useQuery({
    queryKey: ['lesson-import', lessonId],
    queryFn: () => lessonsApi.get(lessonId!),
    enabled: lessonId !== null,
    retry: 2,
    refetchInterval: (query) =>
      query.state.error || (query.state.data && query.state.data.status !== 'processing')
        ? false
        : 1000,
  })
  const retry = useMutation({
    mutationFn: () => lessonsApi.retryImport(lessonId!),
    onSuccess: () => {
      queryClient.setQueryData(['lesson-import', lessonId], undefined)
      void lesson.refetch()
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
    },
  })
  useEffect(() => {
    if (lesson.data?.status === 'ready') {
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
      onOpenChange(false)
    }
    if (lesson.data?.status === 'failed') {
      void queryClient.invalidateQueries({ queryKey: ['lessons', lang] })
    }
  }, [lesson.data?.status, queryClient, lang, onOpenChange])

  const busy = create.isPending || lessonId !== null
  const failed = lesson.data && !['processing', 'ready'].includes(lesson.data.status)
  const shownError = error ?? lesson.error ?? retry.error
  function errorMessage(err: unknown) {
    if (typeof err === 'string') return t(err)
    if (err instanceof ApiError && FILE_ERRORS[err.detail]) return t(FILE_ERRORS[err.detail]!)
    if (err instanceof ApiError && VIDEO_IMPORT_ERRORS[err.detail])
      return t(videoImportError(err.detail))
    return getApiErrorMessage(err)
  }
  function selectFiles(files: FileList | File[]) {
    if (busy || files.length === 0) return
    setError(null)
    setFile(null)
    if (files.length !== 1) {
      setError(msg('Choose one file.'))
      return
    }
    const selected = files[0]!
    if (!/\.(txt|md)$/i.test(selected.name)) {
      setError(msg('Only .txt and .md files with text content are supported.'))
      return
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError(msg('The file must not exceed 5 MiB.'))
      return
    }
    if (selected.size === 0) {
      setError(msg('The file must contain non-empty text.'))
      return
    }
    setFile(selected)
    setTitle(selected.name.replace(/\.(txt|md)$/i, ''))
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const tagError = tagInputError(parseTagInput(tagText))
    if (tagError) {
      setError(tagError)
      return
    }
    if (tab === 'youtube') {
      if (!url.trim()) {
        setError(msg('Enter an HTTPS link to a single YouTube video.'))
        return
      }
      create.mutate()
      return
    }
    if (tab === 'file' && !file) {
      setError(msg('Choose a .txt or .md file.'))
      return
    }
    if (!title.trim() || (tab === 'text' && !text.trim())) {
      setError(msg('Enter a title and text'))
      return
    }
    if ([...title.trim()].length > 200) {
      setError(msg('The title must contain no more than 200 characters.'))
      return
    }
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!create.isPending) onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('Import lesson')}</DialogTitle>
          <DialogDescription>
            {tab === 'youtube'
              ? t('Import the title and captions from YouTube. Language: {{language}}.', {
                  language: lang.toUpperCase(),
                })
              : tab === 'text'
                ? t('Paste text for a new lesson in the current language ({{language}}).', {
                    language: lang.toUpperCase(),
                  })
                : t(
                    'Upload a UTF-8 .txt or .md file, up to 5 MiB. Lesson language: {{language}}.',
                    {
                      language: lang.toUpperCase(),
                    },
                  )}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          <Tabs.Root
            value={tab}
            onValueChange={(value) => {
              setTab(value)
              setError(null)
            }}
          >
            <Tabs.List
              aria-label={t('Import method')}
              className="mb-4 flex rounded-lg bg-muted p-1"
            >
              {[
                ['text', msg('Text')],
                ['file', msg('File')],
                ['youtube', 'YouTube'],
              ].map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value!}
                  disabled={busy}
                  className="flex-1 rounded-md px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm disabled:opacity-50"
                >
                  {t(label!)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {tab !== 'youtube' && (
              <div className="mb-4 space-y-2">
                <Label htmlFor="lesson-title">{t('Title')}</Label>
                <Input
                  id="lesson-title"
                  required
                  maxLength={200}
                  disabled={busy}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}
            <Tabs.Content value="youtube" className="space-y-3">
              <Label htmlFor="youtube-url">{t('YouTube link')}</Label>
              <Input
                id="youtube-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value)
                  requestId.current = null
                }}
              />
              <p className="text-sm text-muted-foreground">
                {t('Prefer creator captions, then automatic captions in the same language.')}
              </p>
            </Tabs.Content>
            <Tabs.Content value="text" className="space-y-2">
              <Label htmlFor="lesson-text">{t('Text')}</Label>
              <textarea
                id="lesson-text"
                required
                rows={10}
                disabled={busy}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </Tabs.Content>
            <Tabs.Content value="file">
              <div
                aria-label={t('Drop a file here')}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!busy) setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  selectFiles(e.dataTransfer.files)
                }}
                className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <Upload aria-hidden="true" className="size-7 text-muted-foreground" />
                <p className="text-sm">{t('Drop a file here')}</p>
                <Label htmlFor="lesson-file" className="sr-only">
                  {t('Choose file')}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('Choose file')}
                </Button>
                <Input
                  id="lesson-file"
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md"
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.files) selectFiles(e.target.files)
                    e.target.value = ''
                  }}
                  className="sr-only"
                />
                {file && <p className="max-w-full break-all text-sm font-medium">{file.name}</p>}
              </div>
            </Tabs.Content>
          </Tabs.Root>
          <div className="space-y-2">
            <Label htmlFor="lesson-tags">{t('Tags (comma-separated)')}</Label>
            <Input
              id="lesson-tags"
              disabled={busy}
              value={tagText}
              placeholder={t('e.g. news, podcast')}
              onChange={(e) => setTagText(e.target.value)}
            />
          </div>
          {shownError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(shownError)}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {tab === 'youtube'
                ? t(videoImportError(lesson.data?.import_error?.code))
                : t('Could not process the lesson. Close this window and try importing again.')}
            </p>
          )}
          {lessonId && !failed && !lesson.error && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('Processing lesson… You can close this window: the import will continue.')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {lessonId ? t('Close') : t('Cancel')}
            </Button>
            {lesson.error && (
              <Button
                type="button"
                onClick={() => {
                  void lesson.refetch()
                }}
              >
                {t('Check status')}
              </Button>
            )}
            {failed && tab === 'youtube' && lesson.data?.import_error?.retryable && (
              <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending ? t('Saving…') : t('Retry import')}
              </Button>
            )}
            {!lessonId && (
              <Button type="submit" disabled={busy}>
                {create.isPending
                  ? t('Saving…')
                  : tab === 'youtube'
                    ? t('Import')
                    : t('Create lesson')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
