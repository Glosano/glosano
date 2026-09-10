import { useState } from 'react'
import { Check, CircleSlash2, Plus } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import type { LessonVocabularyItem } from '@/api/reader'
import { ConfidencePicker } from '@/components/ConfidencePicker'

import { vocabularyRowKey } from './lessonVocabulary'
import { useWordCardMutations } from './useWordCard'

export type VocabularyRowAction = 'add' | 'known' | 'ignore' | 'confidence'

interface Props {
  item: LessonVocabularyItem
  lessonId: string
  lang: string
  target: string
  onOpen: (item: LessonVocabularyItem) => void
  onActionStart: (key: string, action: VocabularyRowAction) => void
  onActionComplete: (key: string, action: VocabularyRowAction) => void
}

interface Attempt {
  action: VocabularyRowAction
  status: 'tracked' | 'known' | 'ignored'
  confidence: number | null
}

export function LessonVocabularyRow({
  item,
  lessonId,
  lang,
  target,
  onOpen,
  onActionStart,
  onActionComplete,
}: Props) {
  const key = vocabularyRowKey(item)
  const [failedAttempt, setFailedAttempt] = useState<Attempt | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const mutations = useWordCardMutations({
    kind: item.kind,
    lang,
    text: item.kind === 'phrase' ? item.display_text : item.text,
    surfaceText: item.display_text,
    target,
    lessonId,
    segId: item.context?.segment_id ?? null,
  })
  const pending = mutations.setStatus.isPending

  async function apply(attempt: Attempt) {
    setFailedAttempt(null)
    onActionStart(key, attempt.action)
    try {
      await mutations.setStatus.mutateAsync({
        itemId: item.item_id,
        status: attempt.status,
        confidence: attempt.confidence,
      })
      onActionComplete(key, attempt.action)
    } catch {
      setFailedAttempt(attempt)
    }
  }

  const translation = item.primary_translation?.text ?? 'Без перевода'

  return (
    <li
      data-vocabulary-row-key={key}
      aria-busy={pending || undefined}
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-stretch gap-2 px-4 ${item.status === 'new' ? 'min-h-14' : 'min-h-16'}`}
    >
      <div className="flex items-center justify-start">
        {item.status === 'new' && (
          <button
            type="button"
            data-vocabulary-action="add"
            aria-label={`Добавить ${item.display_text} в изучение`}
            disabled={pending}
            onClick={() => void apply({ action: 'add', status: 'tracked', confidence: 1 })}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-accent disabled:opacity-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--reader-new-bg)] text-primary">
              <Plus className="h-4 w-4" />
            </span>
          </button>
        )}
        {item.status === 'tracked' && (
          <PopoverPrimitive.Root open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                data-vocabulary-action="confidence"
                aria-label={`Изменить уровень ${item.display_text}, текущий ${item.confidence}`}
                disabled={pending}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--vocab-picker-active-bg)] text-xs font-semibold text-[var(--vocab-picker-active-fg)]">
                  {item.confidence}
                </span>
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                data-reader-panel-popover
                side="left"
                align="center"
                sideOffset={8}
                className="z-[calc(var(--z-modal)+1)] rounded-lg border border-border bg-card p-2 shadow-lg outline-none"
              >
                <ConfidencePicker
                  size="sm"
                  status={item.status}
                  confidence={item.confidence}
                  onSelect={(status, confidence) => {
                    setPickerOpen(false)
                    void apply({ action: 'confidence', status, confidence })
                  }}
                />
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        )}
        {item.status === 'known' && (
          <span
            role="img"
            aria-label="Известно"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--vocab-known-bg)] text-white"
          >
            <Check className="h-4 w-4" />
          </span>
        )}
        {item.status === 'ignored' && (
          <span
            role="img"
            aria-label="Игнорируется"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground"
          >
            <CircleSlash2 className="h-4 w-4" />
          </span>
        )}
      </div>

      <button
        type="button"
        data-vocabulary-action="open"
        aria-label={`Открыть карточку ${item.display_text}`}
        disabled={pending}
        onClick={() => onOpen(item)}
        className="min-w-0 border-b border-border py-3 text-left disabled:opacity-60"
      >
        <span className="block break-words font-medium leading-5">{item.display_text}</span>
        {item.status !== 'new' && (
          <span className="mt-1 block break-words text-[13px] text-muted-foreground">
            {translation}
          </span>
        )}
        {item.context === null && (
          <span className="mt-1 block text-xs text-muted-foreground">Нет в текущем тексте</span>
        )}
      </button>

      <div className="flex items-center justify-end gap-1 py-2">
        {item.status === 'new' && (
          <>
            <button
              type="button"
              data-vocabulary-action="known"
              aria-label={`Отметить ${item.display_text} как известное`}
              disabled={pending}
              onClick={() => void apply({ action: 'known', status: 'known', confidence: null })}
              className="min-h-11 rounded-md px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              Знаю
            </button>
            <button
              type="button"
              data-vocabulary-action="ignore"
              aria-label={`Игнорировать ${item.display_text}`}
              disabled={pending}
              onClick={() => void apply({ action: 'ignore', status: 'ignored', confidence: null })}
              className="min-h-11 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Игнорировать
            </button>
          </>
        )}
      </div>

      {failedAttempt && (
        <div
          role="alert"
          className="col-span-3 flex items-center justify-between pb-2 text-sm text-destructive"
        >
          <span>Не удалось сохранить</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => void apply(failedAttempt)}
            className="rounded px-2 py-1 underline disabled:opacity-50"
          >
            Повторить
          </button>
        </div>
      )}
    </li>
  )
}
