import { useI18n } from '@/lib/i18n'
import { useEffect, useRef } from 'react'

interface Props {
  count: number
  onUndo: () => void
  onDismiss: () => void
}

const AUTO_DISMISS_MS = 6000

export function UndoToast({ count, onUndo, onDismiss }: Props) {
  const { t: tr } = useI18n()
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  // Arm the auto-dismiss timer exactly once for the lifetime of this toast —
  // parent re-renders (e.g. inline onDismiss callbacks) must not re-arm it.
  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      data-testid="undo-toast"
      className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
    >
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
        <span className="text-sm">{tr('{{count}} words marked as known', { count })}</span>
        <button
          type="button"
          onClick={onUndo}
          className="text-sm font-medium text-primary hover:underline"
        >
          {tr('Undo')}
        </button>
      </div>
    </div>
  )
}
