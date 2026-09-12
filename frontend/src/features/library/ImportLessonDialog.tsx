import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Tabs } from 'radix-ui'
import { Upload } from 'lucide-react'

import { lessonsApi } from '@/api/lessons'
import { ApiError, getApiErrorMessage } from '@/api/client'
import { useTranslation } from '@/lib/i18n'
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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MAX_FILE_BYTES = 5 * 1024 * 1024
const FILE_ERRORS: Record<string, string> = {
  'unsupported lesson file': 'Поддерживаются только .txt и .md с текстовым содержимым.',
  'lesson file too large': 'Размер файла не должен превышать 5 МиБ.',
  'lesson file must be UTF-8': 'Сохраните файл в кодировке UTF-8 и попробуйте снова.',
  'lesson file must contain text': 'Файл должен содержать непустой текст.',
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

  const create = useMutation({
    mutationFn: () =>
      tab === 'file' && file
        ? lessonsApi.importFile(file, title.trim(), lang)
        : lessonsApi.create({
            title: title.trim(),
            language_code: lang,
            raw_text: text.trim(),
            visibility: 'private',
          }),
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
  const shownError = error ?? lesson.error
  function errorMessage(err: unknown) {
    if (typeof err === 'string') return t(err)
    if (err instanceof ApiError && FILE_ERRORS[err.detail]) return t(FILE_ERRORS[err.detail]!)
    return getApiErrorMessage(err)
  }
  function selectFiles(files: FileList | File[]) {
    if (busy || files.length === 0) return
    setError(null)
    setFile(null)
    if (files.length !== 1) {
      setError('Выберите один файл.')
      return
    }
    const selected = files[0]!
    if (!/\.(txt|md)$/i.test(selected.name)) {
      setError('Поддерживаются только .txt и .md с текстовым содержимым.')
      return
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError('Размер файла не должен превышать 5 МиБ.')
      return
    }
    if (selected.size === 0) {
      setError('Файл должен содержать непустой текст.')
      return
    }
    setFile(selected)
    setTitle(selected.name.replace(/\.(txt|md)$/i, ''))
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (tab === 'file' && !file) {
      setError('Выберите файл .txt или .md.')
      return
    }
    if (!title.trim() || (tab === 'text' && !text.trim())) {
      setError('Заполните название и текст')
      return
    }
    if ([...title.trim()].length > 200) {
      setError('Название должно содержать не более 200 символов.')
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
          <DialogTitle>{t('Импорт урока')}</DialogTitle>
          <DialogDescription>
            {tab === 'text'
              ? t('Вставьте текст для нового урока на текущем языке ({{language}}).', {
                  language: lang.toUpperCase(),
                })
              : t('Загрузите .txt или .md в UTF-8, до 5 МиБ. Язык урока: {{language}}.', {
                  language: lang.toUpperCase(),
                })}
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
              aria-label={t('Способ импорта')}
              className="mb-4 flex rounded-lg bg-muted p-1"
            >
              {[
                ['text', 'Текст'],
                ['file', 'Файл'],
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
            <div className="mb-4 space-y-2">
              <Label htmlFor="lesson-title">{t('Название')}</Label>
              <Input
                id="lesson-title"
                required
                maxLength={200}
                disabled={busy}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <Tabs.Content value="text" className="space-y-2">
              <Label htmlFor="lesson-text">{t('Текст')}</Label>
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
                aria-label={t('Перетащите файл сюда')}
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
                <p className="text-sm">{t('Перетащите файл сюда')}</p>
                <Label htmlFor="lesson-file" className="sr-only">
                  {t('Выбрать файл')}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('Выбрать файл')}
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
          {shownError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(shownError)}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('Не удалось обработать урок. Закройте окно и попробуйте импортировать снова.')}
            </p>
          )}
          {lessonId && !failed && !lesson.error && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('Обработка урока… Можно закрыть окно: импорт продолжится.')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {lessonId ? t('Закрыть') : t('Отмена')}
            </Button>
            {lesson.error && (
              <Button
                type="button"
                onClick={() => {
                  void lesson.refetch()
                }}
              >
                {t('Проверить статус')}
              </Button>
            )}
            {!lessonId && (
              <Button type="submit" disabled={busy}>
                {create.isPending ? t('Сохранение…') : t('Создать урок')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
