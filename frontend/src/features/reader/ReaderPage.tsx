import type { ParagraphQuoteAction } from './ParagraphQuote'
import { useI18n } from '@/lib/i18n'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chatsApi } from '@/api/chats'
import { containsQuote } from '@/features/chat/inlineQuotes'
import { ChatWorkspace } from '@/features/chat/ChatWorkspace'
import { ChatSidebar } from '@/features/chat/ChatSidebar'
import { useChatLayoutStore } from '@/features/chat/chatLayoutStore'
import { chatDrafts, useChatStore } from '@/features/chat/chatStore'
import { ApiError } from '@/api/client'

import { isWord, type LessonVocabularyItem, type Sentence } from '@/api/reader'
import { randomId } from '@/lib/randomId'
import { cn } from '@/lib/utils'

import { CompletionScreen } from './CompletionScreen'
import { EndOfMaterial } from './EndOfMaterial'
import { BottomToolbar } from './BottomToolbar'
import { LessonVocabularyList } from './LessonVocabularyList'
import { LessonVocabularyPanel } from './LessonVocabularyPanel'
import { toSelectedVocabularyItem } from './lessonVocabulary'
import { paginate, pageIndexForOrdinal } from './pagination'
import { PageView } from './PageView'
import { buildPhraseIndex, buildSelection, type PhraseMatch } from './phraseMatching'
import { useReaderStore } from './readerStore'
import { ReaderTopBar } from './ReaderTopBar'
import { SentenceView } from './SentenceView'
import { UndoToast } from './UndoToast'
import { usePhraseSelection, type DragRange } from './usePhraseSelection'
import { usePositionSync } from './usePositionSync'
import { useReaderHotkeys } from './useReaderHotkeys'
import {
  useBulkKnown,
  useCompleteLesson,
  useLessonContent,
  useLessonDetail,
  usePhrases,
  useTokenStatuses,
  useUndoBulk,
} from './useReaderQueries'
import { useSwipe } from './useSwipe'
import { WordCard } from './WordCard'
import type { SelectedItem } from './selectedItem'
import { VideoPlayer, type VideoControls } from './video/VideoPlayer'
import { activeFragment, intervalFor } from './video/playback'
import { useVideoPageTransitions } from './video/useVideoPageTransitions'

interface Props {
  lang: string
  lessonId: string
  sourcePosition?: {
    sourceVersion: number
    ordinal: number
    paragraphIndex?: number
    requestId?: string
  }
}

const FONT_SIZE_CLASS = ['text-base', 'text-lg', 'text-xl'] as const
const LINE_HEIGHT_CLASS = ['leading-normal', 'leading-relaxed', 'leading-loose'] as const

export function ReaderPage({ lang, lessonId, sourcePosition }: Props) {
  const { language: targetLanguage, t: tr } = useI18n()
  const navigate = useNavigate()
  const { data: lessonDetail, isError: lessonDetailError } = useLessonDetail(lessonId)
  const status = lessonDetail?.status
  const contentEnabled = status === 'ready'

  const { data: content, isLoading: contentLoading } = useLessonContent(lessonId, contentEnabled)
  const { data: statuses } = useTokenStatuses(lessonId, contentEnabled)

  const [chatOpen, setChatOpen] = useState(false)
  const chatListOpen = useChatLayoutStore((s) => s.sidebarOpen)
  const setChatListOpen = useChatLayoutStore((s) => s.setSidebarOpen)
  const [citationError, setCitationError] = useState<string | null>(null)
  const pendingQuote = useChatStore((s) => s.preparations[s.activeId ?? 'new'])
  const chatUser = useChatStore((s) => s.userId)
  const sourceVersionRef = useRef(content?.source_version)
  sourceVersionRef.current = content?.source_version
  const preparingCitation =
    !!pendingQuote &&
    pendingQuote.lesson === lessonId &&
    pendingQuote.source === content?.source_version
  const [paragraphErrors, setParagraphErrors] = useState<Record<string, string>>({})
  const activeDraft = useChatStore((state) => state.entries[state.activeId ?? 'new'])
  const preparedSelections = useChatStore((state) => state.citationTexts)
  const readerPage = useRef<HTMLDivElement>(null)
  const [selectedWord, setSelectedWord] = useState<SelectedItem | null>(null)
  // Вхождение, из которого открыта карточка: держит подсветку выделения,
  // пока карточка открыта; гаснет при закрытии или при выборе статуса
  // (дальше слово помечает статусный цвет).
  const [selectionRange, setSelectionRange] = useState<DragRange | null>(null)
  const [toastCount, setToastCount] = useState<number | null>(null)
  // ADR-0023: UI-only end-of-material page; page/sentence index stays on the last fragment.
  const [atEnd, setAtEnd] = useState(false)
  const [resultsDismissed, setResultsDismissed] = useState(false)
  const [completionError, setCompletionError] = useState(false)
  const mutationLock = useRef(false)
  const activeLesson = useRef(lessonId)
  activeLesson.current = lessonId
  const completionStatus = useRef<HTMLDivElement>(null)
  const finishButton = useRef<HTMLButtonElement>(null)
  const restoreReaderFocus = useRef(false)
  const [bulkErrorVisible, setBulkErrorVisible] = useState(false)
  const videoControls = useRef<VideoControls>(null)
  const [autoPages, setAutoPages] = useState(false)
  const [activeSegment, setActiveSegment] = useState<string | null>(null)
  const [videoReset, setVideoReset] = useState(0)
  const [videoTargetTime, setVideoTargetTime] = useState<number | null>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const manualRequests = useRef(new Map<string, string>())

  const mode = useReaderStore((s) => s.mode)
  const pageIndex = useReaderStore((s) => s.pageIndex)
  const sentenceFlatIndex = useReaderStore((s) => s.sentenceFlatIndex)
  const vocabularyPanelPinned = useReaderStore((s) => s.vocabularyPanelPinned)
  const font = useReaderStore((s) => s.font)
  const lastBulkActionId = useReaderStore((s) => s.lastBulkActionId)
  const setMode = useReaderStore((s) => s.setMode)
  const setPageIndex = useReaderStore((s) => s.setPageIndex)
  const setSentenceFlatIndex = useReaderStore((s) => s.setSentenceFlatIndex)
  const setVocabularyPanelPinned = useReaderStore((s) => s.setVocabularyPanelPinned)
  const setLastBulkActionId = useReaderStore((s) => s.setLastBulkActionId)

  const bulkKnown = useBulkKnown(lessonId, lang)
  const completeLesson = useCompleteLesson(lessonId, lang)
  const undoBulk = useUndoBulk(lessonId, lang)

  const pages = useMemo(() => (content ? paginate(content.paragraphs) : []), [content])
  const flatSentences = useMemo(
    () => (content ? content.paragraphs.flatMap((p) => p.sentences) : []),
    [content],
  )

  // Reader state (page/sentence position, the armed undo action, any visible
  // toast) is global zustand store state, not scoped to a lesson. Without an
  // explicit reset keyed on lessonId, navigating lesson A -> lesson B leaves
  // A's position and armed undo action stale and active against B's UI —
  // e.g. Ctrl+Z on lesson B could undo lesson A's bulk-known action. This
  // must run BEFORE the position-restore init effect below so the new
  // lesson never observes the previous lesson's leftover state.
  useEffect(() => {
    setPageIndex(0)
    setSentenceFlatIndex(0)
    setLastBulkActionId(null)
    setToastCount(null)
    setBulkErrorVisible(false)
    setAtEnd(false)
    setCompletionError(false)
    setResultsDismissed(false)
    mutationLock.current = false
    restoreReaderFocus.current = false
    setSelectedWord(null)
    setSelectionRange(null)
    setAutoPages(false)
    setActiveSegment(null)
    setVideoTargetTime(null)
    setVideoPlaying(false)
    manualRequests.current.clear()
  }, [lessonId, setPageIndex, setSentenceFlatIndex, setLastBulkActionId])

  // Tracks which lesson's position has already been restored, so re-renders
  // (or content/lessonDetail refetches) for the same lesson don't re-run
  // init, but a genuine lesson change does.
  const initializedRef = useRef<string | null>(null)
  useEffect(() => {
    if (initializedRef.current === lessonId || !content || !lessonDetail) return
    const readerPosition = lessonDetail.reader_position
    if (content.media && readerPosition?.current_segment_id) {
      const restored = flatSentences.find(
        (sentence) => sentence.seg_id === readerPosition.current_segment_id,
      )
      if (restored?.media_start_ms != null) {
        setVideoTargetTime(restored.media_start_ms / 1000)
        setVideoReset((value) => value + 1)
      }
    }
    if (readerPosition?.completion_action_id)
      setLastBulkActionId(readerPosition.completion_action_id)
    const initialMode = readerPosition?.view_mode ?? 'page'
    setMode(initialMode)
    if (initialMode === 'sentence' && readerPosition?.current_segment_id) {
      const segId = readerPosition.current_segment_id
      const idx = flatSentences.findIndex((s) => s.seg_id === segId)
      setSentenceFlatIndex(idx === -1 ? 0 : idx)
    } else {
      setPageIndex(pageIndexForOrdinal(pages, readerPosition?.current_token_ordinal ?? null))
    }
    initializedRef.current = lessonId
  }, [
    lessonId,
    content,
    lessonDetail,
    pages,
    flatSentences,
    setMode,
    setPageIndex,
    setSentenceFlatIndex,
    setLastBulkActionId,
  ])

  const sourceTarget = useRef<string | null>(null)
  useEffect(() => {
    if (!content || !sourcePosition || initializedRef.current !== lessonId) return
    const target = `${lessonId}:${sourcePosition.sourceVersion}:${sourcePosition.ordinal}:${sourcePosition.paragraphIndex ?? ''}:${sourcePosition.requestId ?? ''}`
    if (sourceTarget.current === target || content.source_version !== sourcePosition.sourceVersion)
      return
    const paragraph =
      sourcePosition.paragraphIndex != null
        ? content.paragraphs[sourcePosition.paragraphIndex]
        : undefined
    const sentenceIndex = paragraph?.sentences[0]
      ? flatSentences.findIndex((sentence) => sentence.seg_id === paragraph.sentences[0]!.seg_id)
      : flatSentences.findIndex((sentence) =>
          sentence.tokens.some((token) => 'i' in token && token.i === sourcePosition.ordinal),
        )
    if (sentenceIndex < 0) return
    const page = pages.findIndex((page) =>
      page.sentences.some(
        (entry) => entry.sentence.seg_id === flatSentences[sentenceIndex]!.seg_id,
      ),
    )
    videoControls.current?.pause()
    setAutoPages(false)
    setPageIndex(page >= 0 ? page : 0)
    setSentenceFlatIndex(sentenceIndex)
    setSelectionRange(
      paragraph ? null : { from: sourcePosition.ordinal, to: sourcePosition.ordinal },
    )
    sourceTarget.current = target
  }, [content, sourcePosition, lessonId, pages, flatSentences, setPageIndex, setSentenceFlatIndex])

  const statusMap = statuses ?? {}
  const currentPage = pages[pageIndex] ?? pages[0]
  const canPrev = pageIndex > 0
  const canNext = pageIndex < pages.length - 1

  const clampedSentenceIndex = Math.min(
    Math.max(sentenceFlatIndex, 0),
    Math.max(flatSentences.length - 1, 0),
  )
  const currentSentence = flatSentences[clampedSentenceIndex]
  const canPrevSentence = clampedSentenceIndex > 0
  const canNextSentence = clampedSentenceIndex < flatSentences.length - 1
  const videoInterval = intervalFor(
    mode === 'page'
      ? (currentPage?.sentences.map((entry) => entry.sentence) ?? [])
      : currentSentence
        ? [currentSentence]
        : [],
  )
  const autoTransition = useVideoPageTransitions({
    lessonId,
    lang,
    sourceVersion: content?.source_version ?? 1,
    onPage: setPageIndex,
    pause: () => videoControls.current?.pause(),
    onSaved: (result) => {
      if (result.undone) return
      setLastBulkActionId(result.action_id)
      setToastCount(result.created_count > 0 ? result.created_count : null)
    },
  })

  function resetVideo() {
    videoControls.current?.pause()
    setVideoTargetTime(null)
    setVideoReset((value) => value + 1)
  }
  function toggleMode() {
    if (busy) return
    setAtEnd(false)
    const focus =
      flatSentences.find((sentence) => sentence.seg_id === activeSegment) ??
      (mode === 'sentence' ? currentSentence : currentPage?.sentences[0]?.sentence)
    if (focus) {
      setSentenceFlatIndex(flatSentences.indexOf(focus))
      const index = pages.findIndex((page) =>
        page.sentences.some((entry) => entry.sentence.seg_id === focus.seg_id),
      )
      if (index >= 0) setPageIndex(index)
    }
    setAutoPages(false)
    resetVideo()
    if (focus?.media_start_ms != null) setVideoTargetTime(focus.media_start_ms / 1000)
    setMode(mode === 'page' ? 'sentence' : 'page')
  }

  function bulkRequestId(from: number, to: number) {
    const key = `${content?.source_version}:${from}:${to}`
    if (!manualRequests.current.has(key)) manualRequests.current.set(key, randomId())
    return manualRequests.current.get(key)!
  }

  const maxWordOrdinal = useMemo(() => {
    const lastPage = pages[pages.length - 1]
    return lastPage ? lastPage.toOrdinal : -1
  }, [pages])

  const currentOrdinalForProgress = useMemo(() => {
    if (mode === 'page') return currentPage?.toOrdinal ?? null
    const words = currentSentence?.tokens.filter(isWord) ?? []
    return words.length > 0 ? (words[words.length - 1]?.i ?? null) : null
  }, [mode, currentPage, currentSentence])

  const lastFragmentWords =
    mode === 'page'
      ? (currentPage?.sentences.flatMap(({ sentence }) => sentence.tokens.filter(isWord)) ?? [])
      : (currentSentence?.tokens.filter(isWord) ?? [])
  const completedAt = lessonDetail?.reader_position?.completed_at
  const completionActionId = lessonDetail?.reader_position?.completion_action_id
  const showResults = !!completedAt && !!completionActionId && !resultsDismissed
  useEffect(() => {
    if (!showResults && restoreReaderFocus.current) {
      const target = completedAt ? completionStatus.current : finishButton.current
      if (target && !target.hasAttribute('disabled')) {
        target.focus()
        restoreReaderFocus.current = false
      }
    }
  })
  const busy =
    bulkKnown.isPending || completeLesson.isPending || undoBulk.isPending || autoTransition.locked

  const progressPercent = useMemo(() => {
    if (completedAt) return 100
    if (currentOrdinalForProgress == null || maxWordOrdinal < 0) return 0
    if (maxWordOrdinal === 0) return 100
    return Math.min(
      100,
      Math.max(0, Math.round((currentOrdinalForProgress / maxWordOrdinal) * 100)),
    )
  }, [completedAt, currentOrdinalForProgress, maxWordOrdinal])

  const readyForInteraction = contentEnabled && !!content
  const panelVisible = chatOpen || vocabularyPanelPinned || selectedWord !== null

  const contentLang = content?.language_code ?? lang
  const phrases = usePhrases(contentLang, readyForInteraction)
  const phraseIndex = useMemo(() => buildPhraseIndex(phrases.data ?? []), [phrases.data])

  function handlePhraseSelect(range: DragRange, sentence: Sentence) {
    setChatOpen(false)
    videoControls.current?.pause()
    const sel = buildSelection(sentence, range.from, range.to)
    if (!sel) return
    setSelectedWord({
      kind: 'phrase',
      t: sel.displayText,
      n: sel.text,
      i: sel.firstOrdinal,
      endOrdinal: range.to,
      sentenceText: sentence.text,
    })
    setSelectionRange(range)
  }

  function handlePhraseClick(match: PhraseMatch, sentence: Sentence) {
    setChatOpen(false)
    videoControls.current?.pause()
    const slice = sentence.tokens.slice(match.startIdx, match.endIdx + 1)
    const display = slice
      .map((t) => ('t' in t ? t.t : 'p' in t ? t.p : t.ws))
      .join('')
      .trim()
    const words = slice.filter(isWord)
    const first = words[0]
    const last = words[words.length - 1]
    setSelectedWord({
      kind: 'phrase',
      t: display,
      n: match.entry.words.join(' '),
      i: first?.i ?? null,
      endOrdinal: last?.i ?? null,
      sentenceText: sentence.text,
    })
    setSelectionRange(first && last ? { from: first.i, to: last.i } : null)
  }

  const { dragRange, containerProps } = usePhraseSelection({
    enabled: readyForInteraction,
    sentences: flatSentences,
    onSelect: handlePhraseSelect,
  })

  const selectedSentenceText = useMemo(() => {
    if (!selectedWord) return null
    if (selectedWord.segmentId !== undefined) return selectedWord.sentenceText
    if (selectedWord.sentenceText) return selectedWord.sentenceText
    if (selectedWord.i === null) return null
    const sentence = flatSentences.find((s) =>
      s.tokens.some((tok) => isWord(tok) && tok.i === selectedWord.i),
    )
    return sentence?.text ?? null
  }, [selectedWord, flatSentences])

  // Предложение, в котором стоит выделенное слово/фраза — его seg_id уходит
  // в провенанс при добавлении в словарь (FLQ-21). Для фразы `selectedWord.i`
  // — ординал её первого слова, поиск по ординалу работает и для неё.
  const selectedSegId = useMemo(() => {
    if (!selectedWord) return null
    if (selectedWord.segmentId !== undefined) return selectedWord.segmentId
    if (selectedWord.i === null) return null
    const sentence = flatSentences.find((s) =>
      s.tokens.some((tok) => isWord(tok) && tok.i === selectedWord.i),
    )
    return sentence?.seg_id ?? null
  }, [selectedWord, flatSentences])

  const handleWordClick = (w: { t: string; n: string; i: number }) => {
    videoControls.current?.pause()
    setChatOpen(false)
    setSelectedWord({ kind: 'token', ...w, sentenceText: null })
    setSelectionRange({ from: w.i, to: w.i })
  }

  function handleVocabularySelect(item: LessonVocabularyItem) {
    videoControls.current?.pause()
    setChatOpen(false)
    setSelectedWord(toSelectedVocabularyItem(item))
    setSelectionRange(null)
  }

  function openChat() {
    videoControls.current?.pause()
    setAutoPages(false)
    setChatOpen(true)
  }
  function returnToReader() {
    setChatOpen(false)
    readerPage.current?.focus({ preventScroll: true })
  }
  async function addToChat(newConversation: boolean) {
    if (
      selectedWord?.i == null ||
      (selectedWord.kind === 'phrase' && selectedWord.endOrdinal == null)
    )
      return
    await attachSelection(
      { from: selectedWord.i, to: selectedWord.endOrdinal ?? selectedWord.i },
      newConversation,
    )
  }

  function paragraphKey(index: number, cid = chatDrafts.active()) {
    return JSON.stringify([chatUser, cid, lessonId, content?.source_version, 'paragraph', index])
  }

  function paragraphAction(index: number): ParagraphQuoteAction {
    const key = paragraphKey(index)
    const cached = preparedSelections[key]
    const added = cached != null && containsQuote(activeDraft?.draft.text ?? '', cached)
    return {
      state:
        preparingCitation && pendingQuote?.paragraphIndex === index
          ? 'pending'
          : added
            ? 'added'
            : 'ready',
      disabled: !!pendingQuote,
      error: paragraphErrors[key],
    }
  }

  function addParagraphToChat(segmentId: string) {
    const paragraphIndex =
      content?.paragraphs.findIndex((p) => p.sentences.some((s) => s.seg_id === segmentId)) ?? -1
    if (paragraphIndex < 0) return
    void attachSelection(null, false, { segmentId, paragraphIndex })
  }

  async function attachSelection(
    range: DragRange | null,
    newConversation: boolean,
    paragraph?: { segmentId: string; paragraphIndex: number },
  ) {
    if (!content || (!range && !paragraph)) return
    const uid = useChatStore.getState().userId
    if (!uid) return
    const sourceVersion = content.source_version
    const cid = newConversation ? null : chatDrafts.active()
    if (newConversation) chatDrafts.select(null)
    const selection:
      | Parameters<typeof chatsApi.prepareParagraphCitation>[0]
      | Parameters<typeof chatsApi.prepareCitation>[0] = paragraph
      ? {
          lesson_id: lessonId,
          source_version: sourceVersion,
          segment_id: paragraph.segmentId,
        }
      : {
          lesson_id: lessonId,
          source_version: sourceVersion,
          from_ordinal: range!.from,
          to_ordinal: range!.to,
          context: 'paragraph' as const,
        }
    const selectionKey = paragraph
      ? paragraphKey(paragraph.paragraphIndex, cid)
      : JSON.stringify([uid, cid, selection])
    setCitationError(null)
    setParagraphErrors((errors) => {
      const next = { ...errors }
      delete next[selectionKey]
      return next
    })
    const tokens = content.paragraphs.flatMap((paragraph) => [
      ...paragraph.sentences.flatMap((sentence) => [...sentence.tokens, { ws: ' ' }]),
      { ws: '\n\n' },
    ])
    const first = tokens.findIndex((token) => 'i' in token && token.i === range?.from)
    const last = tokens.findIndex((token) => 'i' in token && token.i === range?.to)
    const request = chatDrafts.beginCitation(cid, {
      lesson: lessonId,
      source: sourceVersion,
      paragraphIndex: paragraph?.paragraphIndex,
      text: paragraph
        ? content.paragraphs[paragraph.paragraphIndex]!.sentences.map((s) => s.text).join(' ')
        : tokens
            .slice(first, last + 1)
            .map((token) => ('t' in token ? token.t : 'p' in token ? token.p : token.ws))
            .join(''),
    })
    if (!request) return
    const current = () =>
      useChatStore.getState().userId === uid &&
      activeLesson.current === lessonId &&
      sourceVersionRef.current === sourceVersion &&
      chatDrafts.ownsCitation(cid, request)
    const visible = () => current() && chatDrafts.active() === cid
    openChat()
    try {
      await chatDrafts.load(cid)
      if (!current()) return
      let paragraphText = useChatStore.getState().citationTexts[selectionKey]
      if (paragraphText == null) {
        const citation =
          'segment_id' in selection
            ? await chatsApi.prepareParagraphCitation(selection)
            : await chatsApi.prepareCitation(selection)
        if (!current()) return
        paragraphText = citation.context_text
        chatDrafts.rememberCitation(selectionKey, paragraphText)
      }
      chatDrafts.completeCitation(cid, request, paragraphText)
    } catch (error) {
      if (current()) {
        const message =
          error instanceof ApiError && error.detail === 'inline_quote_too_large'
            ? 'Цитата не помещается в сообщение. Сократите текст и попробуйте ещё раз.'
            : error instanceof ApiError && error.detail === 'citation_too_large'
              ? 'Абзац слишком большой для цитаты. Выберите более короткий абзац.'
              : 'Не удалось приложить цитату. Попробуйте ещё раз.'
        if (paragraph) setParagraphErrors((errors) => ({ ...errors, [selectionKey]: message }))
        else if (visible()) setCitationError(message)
        chatDrafts.cancelCitation(cid, request, error)
      }
    } finally {
      chatDrafts.cancelCitation(cid, request)
    }
  }

  function closeCard() {
    setSelectedWord(null)
    setSelectionRange(null)
  }

  function hideVocabularyPanel() {
    setVocabularyPanelPinned(false)
    closeCard()
  }

  function toggleVocabularyPanel() {
    setChatOpen(false)
    if (vocabularyPanelPinned) {
      hideVocabularyPanel()
      return
    }
    setVocabularyPanelPinned(true)
  }

  function handleEscape() {
    // usePhraseSelection has its own window Escape listener that cancels an
    // active drag; both fire on the same keypress, so without this bail-out
    // cancelling a drag would also navigate the user out of the reader.
    if (dragRange) return
    if (chatOpen) {
      returnToReader()
      return
    }
    if (selectedWord) {
      closeCard()
      return
    }
    if (vocabularyPanelPinned) {
      setVocabularyPanelPinned(false)
      return
    }
    void navigate({ to: '/learn/$lang/library', params: { lang } })
  }

  function handleUndoAction(actionId: string | null | undefined) {
    if (!actionId || mutationLock.current || busy) return
    videoControls.current?.pause()
    setAutoPages(false)
    mutationLock.current = true
    if (showResults) restoreReaderFocus.current = true
    undoBulk.mutate(actionId, {
      onSuccess: () => {
        if (activeLesson.current !== lessonId) return
        setLastBulkActionId(null)
        setToastCount(null)
      },
      onError: () => {
        if (activeLesson.current === lessonId) setBulkErrorVisible(true)
      },
      onSettled: () => {
        if (activeLesson.current === lessonId) mutationLock.current = false
      },
    })
  }

  function handleUndo() {
    handleUndoAction(lastBulkActionId)
  }

  function openEndPage() {
    if (!readyForInteraction || atEnd || mutationLock.current || busy) return
    closeCard()
    setCompletionError(false)
    videoControls.current?.pause()
    setAtEnd(true)
  }

  function leaveEndPage() {
    if (busy) return
    setCompletionError(false)
    restoreReaderFocus.current = true
    setAtEnd(false)
  }

  function handleComplete() {
    if (!atEnd || mutationLock.current || busy || !content) return
    mutationLock.current = true
    setCompletionError(false)
    const words = currentSentence?.tokens.filter(isWord) ?? []
    const from =
      mode === 'page'
        ? currentPage?.wordCount
          ? currentPage.fromOrdinal
          : null
        : (words[0]?.i ?? null)
    const to =
      mode === 'page'
        ? currentPage?.wordCount
          ? currentPage.toOrdinal
          : null
        : (words.at(-1)?.i ?? null)
    completeLesson.mutate(
      {
        lesson_id: lessonId,
        source_version: content.source_version,
        view_mode: mode,
        last_segment_id:
          mode === 'page'
            ? (currentPage?.sentences.at(-1)?.sentence.seg_id ?? null)
            : (currentSentence?.seg_id ?? null),
        from_ordinal: from,
        to_ordinal: to,
      },
      {
        onSuccess: (result) => {
          if (activeLesson.current !== lessonId) return
          setAtEnd(false)
          setResultsDismissed(false)
          setLastBulkActionId(result.action_id)
          setToastCount(null)
        },
        onError: () => {
          if (activeLesson.current === lessonId) setCompletionError(true)
        },
        onSettled: () => {
          if (activeLesson.current === lessonId) mutationLock.current = false
        },
      },
    )
  }

  function handlePrevPage() {
    if (atEnd) {
      leaveEndPage()
      return
    }
    if (!canPrev || mutationLock.current || busy) return
    resetVideo()
    closeCard()
    setPageIndex(Math.max(0, pageIndex - 1))
  }

  function handleNextPage() {
    if (atEnd || mutationLock.current || busy) return
    resetVideo()
    if (!canNext) {
      openEndPage()
      return
    }
    if (!currentPage) return

    if (currentPage.wordCount === 0) {
      // Empty-page marker from pagination (ordinals are 0/-1) — nothing to
      // mark known, just advance.
      closeCard()
      setPageIndex(Math.min(pages.length - 1, pageIndex + 1))
      return
    }

    // Build the request before taking the lock: a throw between the two would
    // leave mutationLock set forever and freeze every navigation in the lesson.
    let requestId: string
    try {
      requestId = bulkRequestId(currentPage.fromOrdinal, currentPage.toOrdinal)
    } catch {
      setBulkErrorVisible(true)
      return
    }

    mutationLock.current = true
    bulkKnown.mutate(
      {
        lesson_id: lessonId,
        from_ordinal: currentPage.fromOrdinal,
        source_version: content?.source_version ?? 1,
        to_ordinal: currentPage.toOrdinal,
        request_id: requestId,
      },
      {
        onSettled: () => {
          if (activeLesson.current === lessonId) mutationLock.current = false
        },
        onSuccess: (result) => {
          if (activeLesson.current !== lessonId) return
          manualRequests.current.delete(
            `${content?.source_version}:${currentPage.fromOrdinal}:${currentPage.toOrdinal}`,
          )
          resetVideo()
          closeCard()
          setPageIndex(Math.min(pages.length - 1, pageIndex + 1))
          // Arm undo even when created_count === 0 (e.g. all words already
          // known) — the server-side bulk action still exists, so Ctrl+Z
          // must stay honest and be able to undo it.
          if (!result.undone) setLastBulkActionId(result.action_id)
          setToastCount(!result.undone && result.created_count > 0 ? result.created_count : null)
        },
        onError: () => {
          // Do not advance the page on failure — show a transient error
          // instead so the user knows the page wasn't marked known.
          setBulkErrorVisible(true)
        },
      },
    )
  }

  function handlePrevSentence() {
    if (atEnd) {
      leaveEndPage()
      return
    }
    if (!canPrevSentence || mutationLock.current || busy) return
    resetVideo()
    closeCard()
    setSentenceFlatIndex(Math.max(0, clampedSentenceIndex - 1))
  }

  function handleNextSentence() {
    if (atEnd || mutationLock.current || busy) return
    resetVideo()
    if (!canNextSentence) {
      openEndPage()
      return
    }
    if (!currentSentence) return

    const words = currentSentence.tokens.filter(isWord)
    const firstWord = words[0]
    const lastWord = words[words.length - 1]
    if (!firstWord || !lastWord) {
      // Punctuation-only sentence — nothing to mark known, just advance.
      closeCard()
      setSentenceFlatIndex(Math.min(flatSentences.length - 1, clampedSentenceIndex + 1))
      return
    }

    // Same ordering as handleNextPage: never take the lock before the request exists.
    let requestId: string
    try {
      requestId = bulkRequestId(firstWord.i, lastWord.i)
    } catch {
      setBulkErrorVisible(true)
      return
    }

    mutationLock.current = true
    bulkKnown.mutate(
      {
        lesson_id: lessonId,
        from_ordinal: firstWord.i,
        source_version: content?.source_version ?? 1,
        to_ordinal: lastWord.i,
        request_id: requestId,
      },
      {
        onSettled: () => {
          if (activeLesson.current === lessonId) mutationLock.current = false
        },
        onSuccess: (result) => {
          if (activeLesson.current !== lessonId) return
          manualRequests.current.delete(`${content?.source_version}:${firstWord.i}:${lastWord.i}`)
          resetVideo()
          closeCard()
          setSentenceFlatIndex(Math.min(flatSentences.length - 1, clampedSentenceIndex + 1))
          // Arm undo even when created_count === 0 — same reasoning as in
          // handleNextPage: the server-side bulk action still exists.
          if (!result.undone) setLastBulkActionId(result.action_id)
          setToastCount(!result.undone && result.created_count > 0 ? result.created_count : null)
        },
        onError: () => {
          // Do not advance the sentence on failure — show a transient error
          // instead so the user knows the sentence wasn't marked known.
          setBulkErrorVisible(true)
        },
      },
    )
  }

  const handlePrev = mode === 'page' ? handlePrevPage : handlePrevSentence
  const handleNext = mode === 'page' ? handleNextPage : handleNextSentence

  useReaderHotkeys({
    enabled: readyForInteraction && !busy && !showResults,
    onPrev: handlePrev,
    onNext: handleNext,
    onToggleMode: toggleMode,
    onEscape: handleEscape,
    onUndo: lastBulkActionId ? handleUndo : undefined,
  })

  const positionSegmentId =
    content?.media && activeSegment
      ? activeSegment
      : mode === 'page'
        ? (currentPage?.sentences[0]?.sentence.seg_id ?? null)
        : (currentSentence?.seg_id ?? null)
  // Persist the same ordinal the progress bar itself is computed from
  // (page-end in page mode, last word of the sentence in sentence mode) —
  // one notion of "where the user is" in this file, so the library card's
  // percent matches this page's own bar exactly. A degenerate page with no
  // word tokens yields toOrdinal -1 (pagination.ts); the wire schema
  // constrains current_token_ordinal to >= 0, so send null instead of a
  // negative ordinal rather than let the PUT 422.
  const positionOrdinal =
    currentOrdinalForProgress != null && currentOrdinalForProgress >= 0
      ? currentOrdinalForProgress
      : null

  const { error: positionError } = usePositionSync({
    lessonId,
    sourceVersion: content?.source_version ?? 1,
    mode,
    currentSegmentId: positionSegmentId,
    currentOrdinal: positionOrdinal,
    enabled: readyForInteraction,
    lang,
  })

  const swipeHandlers = useSwipe({ onSwipeLeft: handleNext, onSwipeRight: handlePrev })

  function handleReaderClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selectedWord) return
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [contenteditable="true"], [data-reader-panel], [data-reader-panel-popover]',
      )
    )
      return
    closeCard()
  }

  useEffect(() => {
    if (!bulkErrorVisible) return
    const timer = window.setTimeout(() => setBulkErrorVisible(false), 4000)
    return () => window.clearTimeout(timer)
  }, [bulkErrorVisible])

  if (
    [positionError, bulkKnown.error, completeLesson.error, autoTransition.error].some(
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        ['lesson_version_changed', 'source_version_conflict'].includes(error.detail),
    )
  ) {
    return (
      <div
        role="alert"
        className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p>{tr('Материал изменился. Обновите страницу, чтобы продолжить чтение.')}</p>
        <a href={`/learn/${lang}/lessons/${lessonId}`} className="text-primary underline">
          {tr('Обновить страницу')}
        </a>
      </div>
    )
  }

  if (lessonDetailError) {
    return (
      <div
        data-testid="reader-error"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4"
      >
        <p className="text-destructive">{tr('Не удалось загрузить урок')}</p>
        <Link to="/learn/$lang/library" params={{ lang }} className="text-primary underline">
          {tr('В библиотеку')}
        </Link>
      </div>
    )
  }

  if (!lessonDetail) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">{tr('Загрузка…')}</p>
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <div
        data-testid="reader-processing"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-muted-foreground">{tr('Урок готовится…')}</p>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div
        data-testid="reader-failed"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4"
      >
        <p className="text-destructive">{tr('Не удалось обработать урок')}</p>
        <Link to="/learn/$lang/library" params={{ lang }} className="text-primary underline">
          {tr('В библиотеку')}
        </Link>
      </div>
    )
  }

  if (status !== 'ready') {
    return (
      <div
        data-testid="reader-unavailable"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4"
      >
        <p className="text-muted-foreground">{tr('Урок недоступен')}</p>
        <Link to="/learn/$lang/library" params={{ lang }} className="text-primary underline">
          {tr('В библиотеку')}
        </Link>
      </div>
    )
  }

  if (showResults && completionActionId) {
    return (
      <CompletionScreen
        key={lessonId}
        lessonId={lessonId}
        actionId={completionActionId}
        lang={lang}
        title={lessonDetail?.title ?? ''}
        busy={busy}
        undoError={bulkErrorVisible}
        statusRef={completionStatus}
        onRead={() => {
          restoreReaderFocus.current = true
          setResultsDismissed(true)
        }}
        onUndo={() => handleUndoAction(completionActionId)}
      />
    )
  }

  const fontClass = cn(
    FONT_SIZE_CLASS[font.size],
    LINE_HEIGHT_CLASS[font.lineHeight],
    font.serif && 'font-serif',
  )

  return (
    <div
      ref={readerPage}
      tabIndex={-1}
      data-testid="reader-page"
      onClick={handleReaderClick}
      className={cn(
        'mx-auto min-h-[calc(100dvh-4rem)] max-w-screen-2xl px-4 pb-24 outline-none sm:px-6',
        panelVisible && 'lg:pr-[var(--reader-panel-reserve)]',
        chatListOpen ? '2xl:pl-[284px]' : '2xl:pl-[72px]',
      )}
    >
      <ReaderTopBar
        lang={lang}
        progressPercent={progressPercent}
        vocabularyPanelPinned={vocabularyPanelPinned}
        onToggleVocabularyPanel={toggleVocabularyPanel}
      />

      {citationError && <p role="alert">{tr(citationError)}</p>}
      {sourcePosition && content && content.source_version !== sourcePosition.sourceVersion && (
        <p role="status">{tr('Позиция цитаты недоступна: материал изменился.')}</p>
      )}
      <aside
        data-reader-panel
        className={cn(
          'fixed bottom-20 left-0 top-16 z-40 hidden border-r border-border/60 bg-background 2xl:block',
          chatListOpen ? 'w-[260px]' : 'w-12',
        )}
      >
        <ChatSidebar
          collapsed={!chatListOpen}
          onToggle={() => setChatListOpen(!chatListOpen)}
          onSelect={openChat}
        />
      </aside>
      {content?.media && videoInterval && (
        <>
          <VideoPlayer
            key={`${lessonId}:${content.source_version}`}
            ref={videoControls}
            media={content.media}
            interval={videoInterval}
            resetKey={`${mode}:${videoReset}`}
            startTime={videoTargetTime}
            continueUntil={
              autoPages && mode === 'page' && canNext
                ? (pages[pageIndex + 1]?.sentences[0]?.sentence.media_start_ms ?? 0) / 1000
                : undefined
            }
            blocked={
              chatOpen ||
              !!selectedWord ||
              !!dragRange ||
              atEnd ||
              bulkKnown.isPending ||
              completeLesson.isPending ||
              undoBulk.isPending ||
              autoTransition.failed
            }
            onTime={(time) => {
              const index = activeFragment(flatSentences, time)
              setActiveSegment(flatSentences[index]?.seg_id ?? null)
            }}
            onPlaying={setVideoPlaying}
            onBoundary={() => {
              if (
                !autoPages ||
                mode !== 'page' ||
                !canNext ||
                !currentPage ||
                busy ||
                mutationLock.current
              )
                return null
              const next = pages[pageIndex + 1]
              const bounds = next && intervalFor(next.sentences.map((entry) => entry.sentence))
              if (!bounds) return null
              return autoTransition.advance(
                currentPage.fromOrdinal,
                currentPage.toOrdinal,
                pageIndex + 1,
              )
                ? bounds
                : null
            }}
            onSeek={
              autoPages && mode === 'page'
                ? (time) => {
                    if (autoTransition.locked) return null
                    const all = intervalFor(flatSentences)
                    if (!all) return null
                    if (time < all.start || time >= all.end) {
                      const index = time < all.start ? 0 : pages.length - 1
                      const edgePage = pages[index]
                      if (!edgePage) return null
                      setPageIndex(index)
                      videoControls.current?.seek(time < all.start ? all.start : all.end)
                      return intervalFor(edgePage.sentences.map((entry) => entry.sentence))
                    }
                    const index = pages.reduce(
                      (found, page, i) =>
                        (page.sentences[0]?.sentence.media_start_ms ?? Infinity) / 1000 <= time
                          ? i
                          : found,
                      -1,
                    )
                    const destination = pages[index]
                    if (!destination) return null
                    setPageIndex(index)
                    return intervalFor(destination.sentences.map((entry) => entry.sentence))
                  }
                : undefined
            }
          />
          <div className="mx-auto mt-3 max-w-[720px] space-y-2 text-sm">
            {mode === 'page' && (
              <>
                <label className="flex cursor-pointer items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={autoPages}
                    disabled={autoTransition.locked}
                    onChange={(event) => setAutoPages(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  {tr('Листать автоматически')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    'Новые слова покинутой страницы становятся известными. Действие можно отменить.',
                  )}
                </p>
              </>
            )}
            {autoTransition.saving && <p role="status">{tr('Сохраняем прогресс страницы…')}</p>}
            {autoTransition.failed && (
              <div role="alert" className="space-y-2 text-destructive">
                <p>
                  {tr('Не удалось сохранить страницу. Повторите сохранение, затем нажмите Play.')}
                </p>
                <Button variant="outline" onClick={autoTransition.retry}>
                  {tr('Повторить сохранение')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Hidden on the end page, which shows its own completed state; opening results
          from here would bring the reader back to the end page instead of the text. */}
      {completedAt && !atEnd && (
        <div
          ref={completionStatus}
          tabIndex={-1}
          role="status"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
        >
          <Check aria-hidden="true" className="size-5 text-primary" />
          <span>{tr('Материал завершён')}</span>
          <Button variant="outline" size="sm" onClick={() => setResultsDismissed(false)}>
            {tr('Итоги чтения')}
          </Button>
          {completionActionId && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => handleUndoAction(completionActionId)}
            >
              {tr('Отменить завершение')}
            </Button>
          )}
          <Link to="/learn/$lang/library" params={{ lang }} className="text-primary underline">
            {tr('В библиотеку')}
          </Link>
        </div>
      )}

      <div
        className={cn('py-6', fontClass)}
        onPointerDownCapture={() => videoControls.current?.pause()}
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchMove={swipeHandlers.onTouchMove}
        onTouchEnd={swipeHandlers.onTouchEnd}
        onTouchCancel={swipeHandlers.onTouchCancel}
        {...containerProps}
      >
        {contentLoading && (
          <div
            data-testid="reader-skeleton"
            className="h-64 w-full animate-pulse rounded-md bg-muted"
          />
        )}
        {!contentLoading && content && atEnd && (
          <EndOfMaterial
            lang={lang}
            lessonId={lessonId}
            completed={!!completedAt}
            showNewWordsNote={lastFragmentWords.some((word) => !statusMap[word.n])}
            busy={busy}
            error={completionError}
            onFinish={handleComplete}
            onBack={leaveEndPage}
          />
        )}
        {!contentLoading && content && !atEnd && mode === 'page' && currentPage && (
          <div data-testid="page-view-slot">
            <PageView
              onQuoteParagraph={addParagraphToChat}
              paragraphAction={paragraphAction}
              activeSegment={activeSegment}
              followPlayback={videoPlaying}
              playbackDisabled={chatOpen || busy || !!selectedWord || !!dragRange || atEnd}
              onSeek={
                content.media
                  ? (sentence) =>
                      videoControls.current?.playFrom((sentence.media_start_ms ?? 0) / 1000)
                  : undefined
              }
              page={currentPage}
              languageCode={content.language_code}
              statuses={statusMap}
              phraseIndex={phraseIndex}
              dragRange={dragRange ?? selectionRange}
              onWordClick={handleWordClick}
              onPhraseClick={handlePhraseClick}
            />
          </div>
        )}
        {!contentLoading && content && !atEnd && mode === 'sentence' && currentSentence && (
          <div data-testid="sentence-view-slot">
            <SentenceView
              onQuoteParagraph={addParagraphToChat}
              paragraphAction={paragraphAction(
                content.paragraphs.findIndex((p) =>
                  p.sentences.some((s) => s.seg_id === currentSentence.seg_id),
                ),
              )}
              video={!!content.media}
              active={!!content.media && activeSegment === currentSentence.seg_id}
              lessonId={lessonId}
              sentence={currentSentence}
              statuses={statusMap}
              phraseIndex={phraseIndex}
              dragRange={dragRange ?? selectionRange}
              lang={content.language_code}
              targetLang={targetLanguage}
              onWordClick={handleWordClick}
              onPhraseClick={handlePhraseClick}
            />
          </div>
        )}
      </div>

      {!contentLoading && content && (
        <>
          <button
            type="button"
            aria-label={
              mode === 'sentence'
                ? tr(content?.media ? 'Предыдущий фрагмент' : 'Предыдущее предложение')
                : tr('Предыдущая страница')
            }
            onClick={handlePrev}
            disabled={busy || (!atEnd && (mode === 'sentence' ? !canPrevSentence : !canPrev))}
            className={cn(
              'fixed left-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-md px-2 py-1 text-3xl text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30 sm:block',
              chatListOpen ? '2xl:left-[268px]' : '2xl:left-14',
            )}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={
              mode === 'sentence'
                ? tr(content?.media ? 'Следующий фрагмент' : 'Следующее предложение')
                : tr('Следующая страница')
            }
            ref={finishButton}
            onClick={handleNext}
            disabled={busy || atEnd}
            className={cn(
              'fixed right-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-md px-2 py-1 text-3xl text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30 sm:block',
              panelVisible && 'lg:right-[var(--reader-panel-reserve)]',
            )}
          >
            ›
          </button>
        </>
      )}

      <BottomToolbar
        video={!!content?.media}
        disabled={busy}
        mode={mode}
        onToggleMode={toggleMode}
        panelOpen={panelVisible}
        onReview={() =>
          void navigate({
            to: '/learn/$lang/review',
            params: { lang },
            search: { lessonId },
          })
        }
      />

      <LessonVocabularyPanel
        key={lessonId}
        lessonId={lessonId}
        pinned={vocabularyPanelPinned}
        selectedWord={selectedWord}
        onClearSelection={closeCard}
        onHide={hideVocabularyPanel}
        chatOpen={chatOpen}
        onChat={openChat}
        onDictionary={() => {
          setChatOpen(false)
          if (!selectedWord) setVocabularyPanelPinned(true)
        }}
        chat={
          <div className="flex min-h-0 flex-1 flex-col">
            <ChatWorkspace
              lang={lang}
              embedded
              onReturn={returnToReader}
              externalList={{
                open: chatListOpen,
                toggle: () => setChatListOpen(!chatListOpen),
              }}
            />
          </div>
        }
        card={
          <WordCard
            onAddToChat={(fresh) => void addToChat(fresh)}
            canAddToChat={
              !pendingQuote &&
              selectedWord?.i != null &&
              (selectedWord.kind === 'token' || selectedWord.endOrdinal != null)
            }
            word={selectedWord}
            lang={content?.language_code ?? lang}
            target={targetLanguage}
            lessonId={lessonId}
            segId={selectedSegId}
            onClose={closeCard}
            onStatusApplied={() => setSelectionRange(null)}
            sentenceText={selectedSentenceText}
            embedded
            closeLabel={vocabularyPanelPinned ? tr('К списку') : tr('Закрыть карточку')}
          />
        }
        renderList={(listState) => (
          <LessonVocabularyList
            lessonId={lessonId}
            lang={content?.language_code ?? lang}
            target={targetLanguage}
            {...listState}
            onSelect={handleVocabularySelect}
          />
        )}
      />

      {toastCount != null && (
        <UndoToast count={toastCount} onUndo={handleUndo} onDismiss={() => setToastCount(null)} />
      )}

      {bulkErrorVisible && (
        <div
          data-testid="bulk-error"
          className="fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center"
        >
          <div className="rounded-full border border-destructive bg-card px-4 py-2 text-sm text-destructive shadow-lg">
            {tr('Не удалось сохранить')}
          </div>
        </div>
      )}
    </div>
  )
}
