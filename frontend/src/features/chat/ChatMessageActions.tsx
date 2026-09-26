import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/copyText'
import { useTranslation } from '@/lib/i18n'

const COPIED_MS = 1500

/**
 * Row under a chat message (FLQ-32.8): copy, the mandatory AI label for
 * replies (ADR-0003) and the timestamp, which no longer sits in a header.
 */
export function ChatMessageActions({
  role,
  text,
  createdAt,
}: {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}) {
  const t = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const when = new Date(createdAt).toLocaleString()
  const label = t(copied ? 'Скопировано' : 'Копировать')
  return (
    <div
      title={when}
      className={`mt-1 flex items-center gap-1 text-xs text-muted-foreground ${
        role === 'user'
          ? 'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100'
          : ''
      }`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={() => void copyText(text).then((ok) => setCopied(ok))}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {role === 'assistant' && <span>{t('Создано AI')}</span>}
      <time dateTime={createdAt} className="sr-only">
        {when}
      </time>
    </div>
  )
}
