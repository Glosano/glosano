import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react'

import { ApiError } from '@/api/client'
import type { ExternalDictionary } from '@/api/externalDictionaries'
import { learningLanguageFlag } from '@/lib/languages'
import { useTranslation, type Translator } from '@/lib/i18n'
import { useExternalDictionaries, useExternalDictionaryMutations } from './useExternalDictionaries'

interface Props {
  lang: string
  target: string
  onDone: () => void
}

type FormState = { mode: 'create' } | { mode: 'edit'; dict: ExternalDictionary }

const iconButton =
  'rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50'

function errorMessage(error: unknown, tr: Translator): string {
  const detail = error instanceof ApiError ? error.detail : ''
  switch (detail) {
    case 'invalid_scheme':
      return tr('Ссылка должна начинаться с http:// или https://')
    case 'missing_placeholder':
      return tr('Добавьте {word} на место слова')
    case 'unknown_placeholder':
      return tr('Кроме {word}, фигурные скобки не допускаются')
    case 'placeholder_in_host':
      return tr('{word} не может стоять в адресе сайта')
    case 'too_long':
      return tr('Ссылка длиннее 500 символов')
    case 'limit_reached':
      return tr('Не больше 30 своих словарей')
    default:
      return tr('Не удалось сохранить')
  }
}

/** Per-pair dictionary list editor that replaces the word card body (FLQ-46). */
export function DictionarySettingsPanel({ lang, target, onDone }: Props) {
  const tr = useTranslation()
  const { data } = useExternalDictionaries(lang, target)
  const m = useExternalDictionaryMutations(lang, target)
  const [form, setForm] = useState<FormState | null>(null)

  const visible = data?.visible ?? []
  const available = data?.available ?? []
  const refs = visible.map((d) => d.ref)
  const busy = m.setLayout.isPending

  function move(index: number, delta: -1 | 1) {
    const next = [...refs]
    const swap = index + delta
    ;[next[index], next[swap]] = [next[swap]!, next[index]!]
    m.setLayout.mutate(next)
  }

  function editButton(d: ExternalDictionary) {
    if (d.kind !== 'custom') return null
    return (
      <button
        type="button"
        aria-label={tr('Изменить «{{name}}»', { name: d.name })}
        onClick={() => setForm({ mode: 'edit', dict: d })}
        className={iconButton}
      >
        <Pencil aria-hidden="true" className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div data-reader-panel-popover data-testid="dictionary-settings" className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {tr('Словари')}{' '}
          <span aria-hidden="true" className="ml-1 font-normal">
            {learningLanguageFlag(lang)} → {learningLanguageFlag(target)}
          </span>
        </p>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2 py-1 text-sm text-primary hover:bg-accent"
        >
          {tr('Готово')}
        </button>
      </div>

      <p className="mt-4 text-sm font-medium">{tr('Показываются')}</p>
      <ul className="mt-1 space-y-1">
        {visible.map((d, i) => (
          <li
            key={d.ref}
            className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm"
          >
            <span className="min-w-0 truncate">{d.name}</span>
            <span className="flex shrink-0 items-center">
              {i > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={tr('Выше «{{name}}»', { name: d.name })}
                  onClick={() => move(i, -1)}
                  className={iconButton}
                >
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {i < visible.length - 1 && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={tr('Ниже «{{name}}»', { name: d.name })}
                  onClick={() => move(i, 1)}
                  className={iconButton}
                >
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {editButton(d)}
              <button
                type="button"
                disabled={busy}
                aria-label={tr('Скрыть «{{name}}»', { name: d.name })}
                onClick={() => m.setLayout.mutate(refs.filter((r) => r !== d.ref))}
                className={iconButton}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <>
          <p className="mt-4 text-sm font-medium">{tr('Доступные')}</p>
          <ul className="mt-1 space-y-1">
            {available.map((d) => (
              <li
                key={d.ref}
                className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">{d.name}</span>
                <span className="flex shrink-0 items-center">
                  {editButton(d)}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={tr('Показать «{{name}}»', { name: d.name })}
                    onClick={() => m.setLayout.mutate([...refs, d.ref])}
                    className={iconButton}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {m.setLayout.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {tr('Не удалось сохранить')}
        </p>
      )}

      {form ? (
        <CustomDictionaryForm
          key={form.mode === 'edit' ? form.dict.ref : 'create'}
          form={form}
          lang={lang}
          target={target}
          onClose={() => setForm(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setForm({ mode: 'create' })}
          className="mt-4 text-sm text-primary hover:underline"
        >
          {tr('+ Добавить свой словарь')}
        </button>
      )}
    </div>
  )
}

function CustomDictionaryForm({
  form,
  lang,
  target,
  onClose,
}: {
  form: FormState
  lang: string
  target: string
  onClose: () => void
}) {
  const tr = useTranslation()
  const m = useExternalDictionaryMutations(lang, target)
  const editing = form.mode === 'edit' ? form.dict : null
  const [name, setName] = useState(editing?.name ?? '')
  const [urlTemplate, setUrlTemplate] = useState(editing?.url_template ?? '')
  const [allLanguages, setAllLanguages] = useState(editing?.all_languages ?? false)
  const [error, setError] = useState<string | null>(null)
  const pending = m.createCustom.isPending || m.updateCustom.isPending || m.deleteCustom.isPending
  const incomplete = name.trim() === '' || urlTemplate.trim() === ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = {
      name: name.trim(),
      url_template: urlTemplate.trim(),
      all_languages: allLanguages,
      source_language_code: lang,
      target_language_code: target,
    }
    try {
      if (editing?.custom_id) {
        await m.updateCustom.mutateAsync({ id: editing.custom_id, payload })
      } else {
        await m.createCustom.mutateAsync(payload)
      }
      onClose()
    } catch (err) {
      setError(errorMessage(err, tr))
    }
  }

  async function remove() {
    if (!editing?.custom_id) return
    if (!window.confirm(tr('Удалить «{{name}}» во всех языках?', { name: editing.name }))) return
    setError(null)
    try {
      await m.deleteCustom.mutateAsync(editing.custom_id)
      onClose()
    } catch (err) {
      setError(errorMessage(err, tr))
    }
  }

  const input =
    'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3 border-t border-border pt-3">
      <div>
        <label htmlFor="ext-dict-name" className="block text-sm font-medium">
          {tr('Название')}
        </label>
        <input
          id="ext-dict-name"
          className={input}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="ext-dict-url" className="block text-sm font-medium">
          {tr('Ссылка')}
        </label>
        <input
          id="ext-dict-url"
          className={input}
          value={urlTemplate}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="ext-dict-url-hint"
          onChange={(e) => setUrlTemplate(e.target.value)}
        />
        <p id="ext-dict-url-hint" className="mt-1 text-xs text-muted-foreground">
          {tr('Замените слово в ссылке на {word}')}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allLanguages}
          onChange={(e) => setAllLanguages(e.target.checked)}
        />
        {tr('Для всех языков')}
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || incomplete}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {tr('Сохранить')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
        >
          {tr('Отмена')}
        </button>
        {editing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void remove()}
            className="ml-auto rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-accent disabled:opacity-50"
          >
            {tr('Удалить словарь')}
          </button>
        )}
      </div>
    </form>
  )
}
