import { create } from 'zustand'
import { ApiError } from '@/api/client'
import { chatsApi, type ChatDraft, type ExerciseKind, type SendCommand } from '@/api/chats'
import { appendQuotes, questionOutsideQuotes } from './inlineQuotes'
import { useUserStore } from '@/stores/userStore'
import { randomId } from '@/lib/randomId'

export const MAX_UNFINISHED_ANSWERS = 30

type PendingSend = { selectionVersion: number; command: SendCommand; snapshot: ChatDraft }
export interface DraftEntry {
  draft: ChatDraft
  loaded: boolean
  dirty: boolean
  saving: boolean
  sending: boolean
  error: unknown
  conversionError: string | null
  convertingCitations: boolean
  conflict: ChatDraft | null
  pending: PendingSend | null
}
const blank = (): DraftEntry => ({
  draft: {
    revision: 0,
    text: '',
    citation_ids: [],
    exercise_id: null,
    attempt_id: null,
    answers: {},
  },
  loaded: false,
  dirty: false,
  saving: false,
  sending: false,
  error: null,
  conversionError: null,
  convertingCitations: false,
  conflict: null,
  pending: null,
})
const EMPTY = blank()
const key = (id: string | null) => id ?? 'new'
interface Operation {
  id: string
  answer: string
}
interface CitationPreparation {
  token: string
  text: string
  lesson: string
  source: number
  paragraphIndex?: number
}
interface State {
  citationTexts: Record<string, string>
  insertionDraftId: string | null
  insertionVersion: number
  preparations: Record<string, CitationPreparation>
  selectionVersion: number
  operations: Record<string, Operation>
  userId: string | null
  activeId: string | null
  entries: Record<string, DraftEntry>
}
export const useChatStore = create<State>(() => ({
  citationTexts: {},
  insertionDraftId: null,
  insertionVersion: 0,
  preparations: {},
  userId: null,
  activeId: null,
  entries: {},
  operations: {},
  selectionVersion: 0,
}))
let epoch = 0
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, Promise<unknown>>()
const sends = new Map<string, Promise<string>>()
const loads = new Map<string, Promise<void>>()
const storageKey = (uid: string) => `glosano.chat.${uid}`
function persist() {
  const { userId, activeId, entries, operations, selectionVersion } = useChatStore.getState()
  if (!userId) return
  try {
    sessionStorage.setItem(
      storageKey(userId),
      JSON.stringify({ activeId, entries, operations, selectionVersion }),
    )
  } catch {
    /* Server save remains available without local storage. */
  }
}
function put(id: string | null, patch: Partial<DraftEntry>) {
  useChatStore.setState((s) => ({
    entries: { ...s.entries, [key(id)]: { ...(s.entries[key(id)] ?? blank()), ...patch } },
  }))
  persist()
}
function current(ticket: number) {
  if (ticket !== epoch || !useChatStore.getState().userId) throw new Error('Chat identity changed')
}
function queue<T>(id: string | null, run: (ticket: number) => Promise<T>): Promise<T> {
  const k = key(id),
    ticket = epoch
  const result = (queues.get(k) ?? Promise.resolve())
    .catch(() => {})
    .then(() => {
      current(ticket)
      return run(ticket)
    })
  queues.set(k, result)
  void result
    .finally(() => {
      if (queues.get(k) === result) queues.delete(k)
    })
    .catch(() => {})
  return result
}
function failure(id: string | null, error: unknown, ticket: number) {
  if (ticket !== epoch) return
  const detail =
    error instanceof ApiError
      ? (error.structuredDetail as { code?: string; draft?: ChatDraft } | undefined)
      : undefined
  put(id, {
    error,
    saving: false,
    sending: false,
    ...(detail?.code === 'draft_conflict' && detail.draft ? { conflict: detail.draft } : {}),
  })
}
async function save(id: string | null, ticket: number) {
  current(ticket)
  const entry = chatDrafts.get(id)
  if (entry.conflict) throw new Error('Resolve draft conflict')
  if (!entry.dirty || entry.pending || entry.conversionError || entry.convertingCitations) return
  if (!entry.loaded) throw new Error('Draft not loaded')
  const snapshot = entry.draft
  put(id, { saving: true, error: null })
  try {
    current(ticket)
    const confirmed = await chatsApi.saveDraft(id, snapshot)
    current(ticket)
    const latest = chatDrafts.get(id)
    put(id, {
      draft:
        latest.draft === snapshot ? confirmed : { ...latest.draft, revision: confirmed.revision },
      dirty: latest.draft !== snapshot,
      saving: false,
    })
  } catch (error) {
    failure(id, error, ticket)
    throw error
  }
}
export const chatDrafts = {
  get: (id: string | null): DraftEntry => useChatStore.getState().entries[key(id)] ?? EMPTY,
  operation(name: string, answer = '') {
    let operation = useChatStore.getState().operations[name]
    if (!operation) {
      operation = { id: randomId(), answer }
      useChatStore.setState((s) => ({ operations: { ...s.operations, [name]: operation! } }))
      persist()
    }
    return operation
  },
  finishOperation(name: string) {
    useChatStore.setState((s) => ({
      operations: Object.fromEntries(Object.entries(s.operations).filter(([k]) => k !== name)),
    }))
    persist()
  },
  active: () => useChatStore.getState().activeId,
  setUser(userId: string | null) {
    const previous = useChatStore.getState().userId
    if (previous === userId) return
    epoch++
    timers.forEach(clearTimeout)
    timers.clear()
    queues.clear()
    loads.clear()
    sends.clear()
    if (previous) {
      try {
        sessionStorage.removeItem(storageKey(previous))
      } catch {
        /* Disabled storage. */
      }
    }
    useChatStore.setState({
      citationTexts: {},
      insertionDraftId: null,
      insertionVersion: 0,
      preparations: {},
      userId,
      activeId: null,
      entries: {},
      operations: {},
      selectionVersion: 0,
    })
    if (userId) this.restoreSession()
  },
  restoreSession() {
    // Requests cannot survive a document reload; never restore a stale Send fence.
    useChatStore.setState({ preparations: {} })
    timers.forEach(clearTimeout)
    timers.clear()
    const uid = useChatStore.getState().userId
    if (!uid) return
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey(uid)) ?? 'null') as Pick<
        State,
        'activeId' | 'entries' | 'operations' | 'selectionVersion'
      > | null
      if (stored?.entries)
        useChatStore.setState({
          activeId: stored.activeId,
          selectionVersion: stored.selectionVersion ?? 0,
          operations: stored.operations ?? {},
          entries: Object.fromEntries(
            Object.entries(stored.entries).map(([k, e]) => [
              k,
              {
                ...e,
                loaded: false,
                saving: false,
                sending: false,
                error: null,
                conversionError: e.conversionError ?? null,
                convertingCitations: false,
              },
            ]),
          ),
        })
    } catch {
      /* Ignore invalid recovery data. */
    }
  },
  select(id: string | null) {
    useChatStore.setState((s) => ({ activeId: id, selectionVersion: s.selectionVersion + 1 }))
    persist()
  },
  remove(id: string) {
    clearTimeout(timers.get(key(id)))
    timers.delete(key(id))
    useChatStore.setState((s) => ({
      activeId: s.activeId === id ? null : s.activeId,
      entries: Object.fromEntries(Object.entries(s.entries).filter(([k]) => k !== id)),
      preparations: Object.fromEntries(Object.entries(s.preparations).filter(([k]) => k !== id)),
    }))
    persist()
  },
  beginCitation(id: string | null, preview: Omit<CitationPreparation, 'token'>): string | null {
    const state = useChatStore.getState()
    const entry = this.get(id)
    if (!state.userId || state.preparations[key(id)] || entry.sending || entry.pending) return null
    const token = randomId()
    // Transient, owned by the draft rather than the route that started the request.
    useChatStore.setState({
      preparations: { ...state.preparations, [key(id)]: { ...preview, token } },
    })
    return token
  },
  ownsCitation(id: string | null, token: string): boolean {
    return useChatStore.getState().preparations[key(id)]?.token === token
  },
  cancelCitation(id: string | null, token: string, error?: unknown) {
    if (!this.ownsCitation(id, token)) return
    useChatStore.setState((s) => ({
      preparations: Object.fromEntries(
        Object.entries(s.preparations).filter(([k]) => k !== key(id)),
      ),
    }))
    if (error) put(id, { error })
  },
  rememberCitation(identity: string, paragraph: string) {
    useChatStore.setState((s) => ({ citationTexts: { ...s.citationTexts, [identity]: paragraph } }))
  },
  completeCitation(id: string | null, token: string, paragraph: string) {
    if (!this.ownsCitation(id, token)) return
    const text = appendQuotes(this.get(id).draft.text, [paragraph])
    this.edit(id, { text })
    useChatStore.setState((s) => ({
      insertionDraftId: id,
      insertionVersion: s.insertionVersion + 1,
    }))
    this.cancelCitation(id, token)
  },
  async convertCitations(id: string | null, ticket = epoch): Promise<void> {
    const entry = this.get(id)
    if (entry.pending || entry.conflict || !entry.draft.citation_ids.length) {
      put(id, { conversionError: null, convertingCitations: false })
      return
    }
    put(id, { loaded: false, convertingCitations: true })
    const ids = entry.draft.citation_ids
    try {
      const snapshots = await Promise.all(ids.map((citationId) => chatsApi.citation(citationId)))
      current(ticket)
      const latest = this.get(id)
      if (latest.pending || latest.conflict) {
        put(id, { convertingCitations: false })
        return
      }
      // Reconcile only IDs still present; never overwrite edits made during snapshot loading.
      const retained = snapshots.filter((snapshot) =>
        latest.draft.citation_ids.includes(snapshot.id),
      )
      const text = appendQuotes(
        latest.draft.text,
        retained.map((snapshot) => snapshot.context_text),
      )
      for (const snapshot of retained) {
        if (snapshot.paragraph_index != null)
          this.rememberCitation(
            JSON.stringify([
              useChatStore.getState().userId,
              id,
              snapshot.lesson_id,
              snapshot.source_version,
              'paragraph',
              snapshot.paragraph_index,
            ]),
            snapshot.context_text,
          )
      }
      this.edit(id, {
        text,
        citation_ids: latest.draft.citation_ids.filter((citationId) => !ids.includes(citationId)),
      })
      put(id, { loaded: true, conversionError: null, convertingCitations: false })
    } catch (error) {
      failure(id, error, ticket)
      if (ticket === epoch)
        put(id, {
          conversionError: error instanceof ApiError ? error.detail : 'citation_conversion_failed',
          convertingCitations: false,
        })
      throw error
    }
  },
  removeLegacyCitations(id: string | null) {
    const entry = this.get(id)
    if (!entry.conversionError || entry.convertingCitations || entry.pending || entry.conflict)
      return
    // This destructive-to-attachments step is only an explicit recovery action.
    this.edit(id, { citation_ids: [] })
    put(id, { loaded: true, conversionError: null, error: null })
  },
  async load(id: string | null): Promise<void> {
    if (this.get(id).loaded) return
    if (loads.has(key(id))) return loads.get(key(id))!
    const ticket = epoch
    const promise = (async () => {
      try {
        current(ticket)
        const remote = await chatsApi.draft(id)
        current(ticket)
        const local = this.get(id)
        if (local.dirty || local.pending)
          put(id, {
            loaded: true,
            ...(local.draft.revision !== remote.revision && !local.pending
              ? { conflict: remote }
              : {}),
          })
        else put(id, { draft: remote, loaded: true, error: null })
        await this.convertCitations(id, ticket)
      } catch (error) {
        failure(id, error, ticket)
        throw error
      }
    })()
    loads.set(key(id), promise)
    try {
      await promise
    } finally {
      if (loads.get(key(id)) === promise) loads.delete(key(id))
    }
  },
  edit(id: string | null, patch: Partial<ChatDraft>) {
    if (!useChatStore.getState().userId) return
    put(id, { draft: { ...this.get(id).draft, ...patch }, dirty: true, error: null })
    clearTimeout(timers.get(key(id)))
    timers.set(
      key(id),
      setTimeout(() => {
        timers.delete(key(id))
        void this.flush(id).catch(() => {})
      }, 450),
    )
  },
  editAnswer(id: string, exerciseId: string, value: string): boolean {
    const answers = Object.fromEntries(
      Object.entries(this.get(id).draft.answers).filter(([, answer]) => answer !== ''),
    )
    if (value === '') delete answers[exerciseId]
    else {
      if (!(exerciseId in answers) && Object.keys(answers).length >= MAX_UNFINISHED_ANSWERS)
        return false
      answers[exerciseId] = value
    }
    this.edit(id, { answers })
    return true
  },
  retireAnswer(id: string, exerciseId: string, submitted: string) {
    // Only retire the raw value acknowledged by the server. Later typing is independent work.
    if (this.get(id).draft.answers[exerciseId] === submitted) this.editAnswer(id, exerciseId, '')
  },
  flush(id: string | null) {
    clearTimeout(timers.get(key(id)))
    timers.delete(key(id))
    return queue(id, (ticket) => save(id, ticket))
  },
  resolve(id: string | null, choice: 'server' | 'local') {
    const entry = this.get(id)
    if (!entry.conflict) return
    put(id, {
      draft:
        choice === 'server'
          ? entry.conflict
          : { ...entry.draft, revision: entry.conflict.revision },
      conflict: null,
      error: null,
      dirty: choice === 'local',
    })
    void this.convertCitations(id)
      .then(() => {
        if (this.get(id).dirty) return this.flush(id)
      })
      .catch(() => {})
  },
  send(
    id: string | null,
    language: string,
    kind: 'reply' | 'exercise' = 'reply',
    exerciseKind: ExerciseKind | null = null,
  ): Promise<string> {
    if (useChatStore.getState().preparations[key(id)])
      return Promise.reject(new Error('Citation preparation pending'))
    const existing = sends.get(key(id))
    if (existing) return existing
    const initial = this.get(id)
    if (!initial.pending && (!initial.loaded || initial.draft.citation_ids.length))
      return Promise.reject(new Error('Draft conversion required'))
    const requested = initial.draft
    const selectionVersion = useChatStore.getState().selectionVersion
    put(id, { sending: true, error: null })
    const resultPromise = queue(id, async (ticket) => {
      try {
        await this.load(id)
        current(ticket)
        let entry = this.get(id)
        if (entry.conflict) throw new Error('Resolve draft conflict')
        let pending = entry.pending
        if (!pending) {
          if (!questionOutsideQuotes(requested.text)) throw new Error('Question required')
          if (kind !== 'reply') throw new Error('Practice disabled')
          let snapshot = { ...requested, revision: entry.draft.revision }
          if (entry.dirty || JSON.stringify(snapshot) !== JSON.stringify(entry.draft)) {
            current(ticket)
            snapshot = await chatsApi.saveDraft(id, snapshot)
            current(ticket)
            entry = this.get(id)
            put(id, { draft: { ...entry.draft, revision: snapshot.revision }, saving: false })
          }
          pending = {
            selectionVersion,
            snapshot,
            command: {
              operation_id: randomId(),
              conversation_id: id,
              draft_revision: snapshot.revision,
              kind,
              exercise_kind: exerciseKind,
              ...(!id ? { learning_language_code: language } : {}),
            },
          }
        }
        put(id, { pending, sending: true, error: null })
        current(ticket)
        const result = await chatsApi.send(pending.command)
        current(ticket)
        const stayNew =
          !id &&
          this.active() === null &&
          useChatStore.getState().selectionVersion !== pending.selectionVersion
        const destination = stayNew ? null : result.conversation_id
        const remote = await chatsApi.draft(destination)
        current(ticket)
        const latest = this.get(id).draft,
          sent = pending.snapshot
        const next = {
          ...remote,
          text: latest.text === sent.text ? remote.text : latest.text,
          citation_ids: [
            ...new Set([
              ...remote.citation_ids,
              ...latest.citation_ids.filter((c) => !sent.citation_ids.includes(c)),
            ]),
          ],
          exercise_id:
            latest.exercise_id === sent.exercise_id ? remote.exercise_id : latest.exercise_id,
          attempt_id: latest.attempt_id === sent.attempt_id ? remote.attempt_id : latest.attempt_id,
          answers: {
            ...remote.answers,
            ...Object.fromEntries(
              Object.entries(latest.answers).filter(([k, v]) => sent.answers[k] !== v),
            ),
          },
        }
        // A completed/cleared answer can disappear while this send is in flight.
        // Applying only surviving entries would resurrect it from the server snapshot.
        for (const exerciseId of Object.keys(sent.answers)) {
          if (!(exerciseId in latest.answers)) delete next.answers[exerciseId]
        }
        const dirty = JSON.stringify(next) !== JSON.stringify(remote)
        const expectedRevision = !id && !stayNew ? 0 : sent.revision + 1
        const conflict = dirty && remote.revision > expectedRevision ? remote : null
        if (!id && !stayNew) {
          put(null, blank())
          if (
            this.active() === null &&
            useChatStore.getState().selectionVersion === pending.selectionVersion
          )
            this.select(result.conversation_id)
        }
        put(destination, {
          draft: next,
          loaded: true,
          pending: null,
          sending: false,
          saving: false,
          error: null,
          dirty,
          conflict,
        })
        if (!conflict) {
          await this.convertCitations(destination, ticket).catch(() => {})
          if (this.get(destination).dirty) void this.flush(destination).catch(() => {})
        }
        return result.conversation_id
      } catch (error) {
        const definitive =
          ticket === epoch && error instanceof ApiError && error.status >= 400 && error.status < 500
        if (definitive) put(id, { pending: null })
        failure(id, error, ticket)
        if (definitive && this.get(id).draft.citation_ids.length) {
          put(id, { loaded: false })
          void this.load(id).catch(() => {})
        }
        throw error
      }
    })
    sends.set(key(id), resultPromise)
    void resultPromise
      .finally(() => {
        if (sends.get(key(id)) === resultPromise) sends.delete(key(id))
      })
      .catch(() => {})
    return resultPromise
  },
}
useUserStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) chatDrafts.setUser(state.user?.id ?? null)
})
chatDrafts.setUser(useUserStore.getState().user?.id ?? null)
