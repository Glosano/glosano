import { Fragment, useEffect, useRef } from 'react'
import { Play } from 'lucide-react'

import type { Sentence, StatusMap } from '@/api/reader'

import type { PageSlice } from './pagination'
import type { PhraseIndex, PhraseMatch } from './phraseMatching'
import { SentenceTokens } from './SentenceTokens'
import type { DragRange } from './usePhraseSelection'
import { learningContentDirection } from '@/lib/languages'
import { mediaTime } from '@/lib/mediaTime'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  activeSegment?: string | null
  followPlayback?: boolean
  onSeek?: (sentence: Sentence) => void
  playbackDisabled?: boolean
  page: PageSlice
  statuses: StatusMap
  phraseIndex: PhraseIndex
  dragRange: DragRange | null
  languageCode: string
  onWordClick?: (word: { t: string; n: string; i: number }) => void
  onPhraseClick?: (match: PhraseMatch, sentence: Sentence) => void
}

export function PageView({
  page,
  statuses,
  phraseIndex,
  dragRange,
  languageCode,
  onWordClick,
  onPhraseClick,
  activeSegment,
  followPlayback,
  onSeek,
  playbackDisabled,
}: Props) {
  const t = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const manualScroll = useRef(false)
  useEffect(() => {
    const stopFollowing = () => {
      manualScroll.current = true
    }
    window.addEventListener('wheel', stopFollowing, { passive: true })
    window.addEventListener('touchmove', stopFollowing, { passive: true })
    return () => {
      window.removeEventListener('wheel', stopFollowing)
      window.removeEventListener('touchmove', stopFollowing)
    }
  }, [])
  useEffect(() => {
    manualScroll.current = false
  }, [page])
  useEffect(() => {
    if (
      !followPlayback ||
      !activeSegment ||
      manualScroll.current ||
      dragRange ||
      document.getSelection()?.toString()
    )
      return
    const target = root.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (rect.top >= 100 && rect.bottom <= window.innerHeight - 100) return
    target.scrollIntoView?.({
      block: 'nearest',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  }, [activeSegment, dragRange, followPlayback])
  const paragraphOrder: number[] = []
  const paragraphs = new Map<number, PageSlice['sentences']>()
  for (const entry of page.sentences) {
    if (!paragraphs.has(entry.paragraphIndex)) {
      paragraphs.set(entry.paragraphIndex, [])
      paragraphOrder.push(entry.paragraphIndex)
    }
    paragraphs.get(entry.paragraphIndex)!.push(entry)
  }

  return (
    <div ref={root} className="mx-auto max-w-[720px]">
      <div data-testid="learning-content" dir={learningContentDirection(languageCode)}>
        {paragraphOrder.map((paragraphIndex) => (
          <p key={paragraphIndex} className="mb-4">
            {paragraphs.get(paragraphIndex)!.map((entry, sentenceIdx) => (
              <Fragment key={entry.sentence.seg_id}>
                {sentenceIdx > 0 && ' '}
                <span
                  data-segment-id={entry.sentence.seg_id}
                  aria-current={activeSegment === entry.sentence.seg_id ? 'true' : undefined}
                  className={cn(
                    onSeek && 'block rounded-sm py-1',
                    activeSegment === entry.sentence.seg_id &&
                      'outline outline-2 outline-primary/70 outline-offset-4',
                  )}
                >
                  {onSeek && entry.sentence.media_start_ms != null && (
                    <button
                      type="button"
                      disabled={playbackDisabled}
                      onClick={() => onSeek(entry.sentence)}
                      aria-label={t('Воспроизвести с {{time}}', {
                        time: mediaTime(entry.sentence.media_start_ms),
                      })}
                      className="me-2 inline-flex min-h-7 items-center gap-1 rounded-s-sm rounded-e-md bg-primary px-2 py-1 align-middle text-xs leading-none font-semibold text-white tabular-nums shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                      dir="ltr"
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {mediaTime(entry.sentence.media_start_ms)}
                    </button>
                  )}
                  <SentenceTokens
                    sentence={entry.sentence}
                    statuses={statuses}
                    phraseIndex={phraseIndex}
                    dragRange={dragRange}
                    onWordClick={onWordClick}
                    onPhraseClick={onPhraseClick}
                  />
                </span>
              </Fragment>
            ))}
          </p>
        ))}
      </div>
    </div>
  )
}
