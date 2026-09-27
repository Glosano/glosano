import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { errorMessage } from '../../lib/errors'
import type { Me } from '../../lib/glosano-client'
import { requestImportText, requestImportYoutube, requestOpenUrl, requestStatus, type Status } from '../../lib/messages'
import type { PageInfo } from '../../lib/page-info'
import { getSettings } from '../../lib/settings'
import { getActiveTab, readPageInfo, startPicker } from '../../lib/tab-ops'
import App from './App'

// ESM namespaces cannot be spied on in Vitest; mock the modules instead.
vi.mock('../../lib/messages')
vi.mock('../../lib/tab-ops')

const ORIGIN = 'https://g.example.com'
const ME: Me = { display_name: 'Ana', learning_languages: ['en', 'pt'], last_learning_language_code: 'en', needs_onboarding: false }
const PAGE: PageInfo = { url: 'https://jornal.pt/a', title: 'Grande título', byline: 'Ana Souza', siteName: 'Jornal', lang: 'pt-PT', selection: '' }
const READY: Status = { status: 'ready', origin: ORIGIN, me: ME }

function setup({ status = READY, url = PAGE.url, page = PAGE as PageInfo | null } = {}) {
  vi.mocked(requestStatus).mockResolvedValue(status)
  vi.mocked(requestOpenUrl).mockResolvedValue()
  vi.mocked(getActiveTab).mockResolvedValue({ id: 7, url, title: 'Aba' })
  vi.mocked(readPageInfo).mockResolvedValue(page)
  vi.mocked(startPicker).mockResolvedValue(true)
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  render(<App />)
  return { close }
}

beforeEach(() => vi.resetAllMocks())

describe('status screens', () => {
  it.each([
    [{ status: 'unconfigured' } as Status, 'Set your Glosano address in settings.', 'Open settings'],
    [{ status: 'no_permission', origin: ORIGIN } as Status, 'Allow access to your Glosano server in settings.', 'Open settings'],
    [{ status: 'signed_out', origin: ORIGIN } as Status, 'Sign in to Glosano in this browser.', 'Sign in to Glosano'],
    [{ status: 'needs_onboarding', origin: ORIGIN } as Status, 'Finish setting up Glosano first.', 'Open Glosano'],
    [{ status: 'unreachable', origin: ORIGIN } as Status, `Can't reach Glosano at ${ORIGIN}.`, 'Open settings'],
  ])('%j', async (status, text, action) => {
    setup({ status })
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
  })

  it('sign-in opens the instance login page', async () => {
    setup({ status: { status: 'signed_out', origin: ORIGIN } })
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to Glosano' }))
    expect(requestOpenUrl).toHaveBeenCalledWith(`${ORIGIN}/login`)
  })

  it('closes the popup only after the open request was delivered', async () => {
    const { close } = setup({ status: { status: 'signed_out', origin: ORIGIN } })
    let delivered!: () => void
    vi.mocked(requestOpenUrl).mockImplementation(() => new Promise<void>((resolve) => (delivered = resolve)))
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to Glosano' }))
    expect(requestOpenUrl).toHaveBeenCalledWith(`${ORIGIN}/login`)
    expect(close).not.toHaveBeenCalled()
    delivered()
    await waitFor(() => expect(close).toHaveBeenCalled())
  })

  it('still closes the popup when the open request fails', async () => {
    const { close } = setup({ status: { status: 'needs_onboarding', origin: ORIGIN } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(requestOpenUrl).mockRejectedValue(new Error('Receiving end does not exist'))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Glosano' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('background failures', () => {
  it('shows an error instead of loading forever when the status check rejects', async () => {
    vi.mocked(requestStatus).mockRejectedValue(new Error('Receiving end does not exist'))
    render(<App />)
    expect(await screen.findByText(errorMessage({ code: 'unknown', detail: 'Error: Receiving end does not exist' }))).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})

describe('import form', () => {
  it('prefills title and the page language', async () => {
    setup()
    expect(await screen.findByLabelText('Title')).toHaveValue('Grande título')
    expect(screen.getByLabelText('Language')).toHaveValue('pt')
    expect(screen.getByRole('radio', { name: 'Article' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Selection' })).toBeDisabled()
  })

  it('caps the prefilled title without splitting an emoji', async () => {
    setup({ page: { ...PAGE, title: `${'a'.repeat(199)}😀tail` } })
    expect(await screen.findByLabelText('Title')).toHaveValue(`${'a'.repeat(199)}😀`)
  })

  it('defaults to Selection when text is selected and imports it', async () => {
    setup({ page: { ...PAGE, selection: 'Olá mundo.\n\nTudo bem?' } })
    vi.mocked(requestImportText).mockResolvedValue({ ok: true, lessonId: 'L1', lessonUrl: `${ORIGIN}/learn/pt/lessons/L1` })
    expect(await screen.findByRole('radio', { name: 'Selection' })).toBeChecked()
    expect(screen.getByText('4 words selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(requestImportText).toHaveBeenCalledWith({
      title: 'Grande título',
      language_code: 'pt',
      text: 'Olá mundo.\n\nTudo bem?',
      source: { url: PAGE.url, author: 'Ana Souza', site_name: 'Jornal' },
    })
    expect(await screen.findByText('Imported.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open lesson' }))
    expect(requestOpenUrl).toHaveBeenCalledWith(`${ORIGIN}/learn/pt/lessons/L1`)
  })

  it('shows import errors and lets the learner retry', async () => {
    setup({ page: { ...PAGE, selection: 'Olá.' } })
    vi.mocked(requestImportText).mockResolvedValue({ ok: false, error: { code: 'validation', detail: 'unsupported language' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Glosano rejected the lesson: unsupported language')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it('shows an unknown error and re-enables Import when the background call rejects', async () => {
    setup({ page: { ...PAGE, selection: 'Olá.' } })
    vi.mocked(requestImportText).mockRejectedValue(new Error('Receiving end does not exist'))
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))
    expect(await screen.findByText(errorMessage({ code: 'unknown', detail: 'Error: Receiving end does not exist' }))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it('Article and Blocks start the on-page picker and close the popup', async () => {
    const { close } = setup()
    await userEvent.click(await screen.findByRole('radio', { name: 'Blocks' }))
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Meu título')
    await userEvent.click(screen.getByRole('button', { name: 'Pick on page' }))
    expect(startPicker).toHaveBeenCalledWith(7, {
      mode: 'blocks',
      title: 'Meu título',
      language_code: 'pt',
      source: { url: PAGE.url, author: 'Ana Souza', site_name: 'Jornal' },
    })
    await waitFor(() => expect(close).toHaveBeenCalled())
  })

  it('does not start the picker twice on a rapid double click', async () => {
    const { close } = setup()
    await userEvent.click(await screen.findByRole('radio', { name: 'Blocks' }))
    let resolveStart!: (value: boolean) => void
    vi.mocked(startPicker).mockImplementation(() => new Promise((resolve) => (resolveStart = resolve)))
    const button = screen.getByRole('button', { name: 'Pick on page' })
    // Two dispatches inside one `act` land in the same render pass, before React
    // commits the first `disabled` update — the only way to see a rapid double
    // click race in a test rather than the DOM already blocking the second click.
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(startPicker).toHaveBeenCalledTimes(1)
    resolveStart(true)
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(startPicker).toHaveBeenCalledTimes(1)
  })

  it('offers only YouTube on a video page and imports the canonical URL', async () => {
    setup({ url: 'https://www.youtube.com/live/dQw4w9WgXcQ', page: null })
    vi.mocked(requestImportYoutube).mockResolvedValue({ ok: true, lessonId: 'V1', lessonUrl: `${ORIGIN}/learn/en/lessons/V1` })
    expect(await screen.findByRole('radio', { name: 'YouTube' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Article' })).toBeNull()
    expect(screen.getByLabelText('Language')).toHaveValue('en')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(requestImportYoutube).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en' })
  })

  it('explains restricted pages', async () => {
    setup({ url: 'chrome://settings', page: null })
    expect(await screen.findByText("Glosano can't read this page.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('asks to add a language when the learner has none', async () => {
    setup({ status: { status: 'ready', origin: ORIGIN, me: { ...ME, learning_languages: [] } } })
    expect(await screen.findByText('Add a learning language in Glosano first.')).toBeInTheDocument()
  })

  it('remembers the open-after-import checkbox', async () => {
    setup()
    const box = await screen.findByLabelText('Open lesson after import')
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect((await getSettings()).openAfterImport).toBe(false)
  })
})

describe('tags', () => {
  it('sends parsed tags with a selection import', async () => {
    setup({ page: { ...PAGE, selection: 'Olá.' } })
    vi.mocked(requestImportText).mockResolvedValue({ ok: true, lessonId: 'L1', lessonUrl: `${ORIGIN}/learn/pt/lessons/L1` })
    await userEvent.type(await screen.findByLabelText('Tags (comma-separated)'), 'News, b2, news')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(requestImportText).toHaveBeenCalledWith(expect.objectContaining({ tags: ['news', 'b2'] }))
  })

  it('passes tags to the on-page picker', async () => {
    setup()
    await userEvent.type(await screen.findByLabelText('Tags (comma-separated)'), 'news')
    await userEvent.click(screen.getByRole('button', { name: 'Pick on page' }))
    expect(startPicker).toHaveBeenCalledWith(7, expect.objectContaining({ mode: 'article', tags: ['news'] }))
  })

  it('passes tags to YouTube imports', async () => {
    setup({ url: 'https://www.youtube.com/live/dQw4w9WgXcQ', page: null })
    vi.mocked(requestImportYoutube).mockResolvedValue({ ok: true, lessonId: 'V1', lessonUrl: `${ORIGIN}/learn/en/lessons/V1` })
    await userEvent.type(await screen.findByLabelText('Tags (comma-separated)'), 'music')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(requestImportYoutube).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', language_code: 'en', tags: ['music'] })
  })

  it('blocks an overlong tag before any request', async () => {
    setup({ page: { ...PAGE, selection: 'Olá.' } })
    fireEvent.change(await screen.findByLabelText('Tags (comma-separated)'), { target: { value: 'x'.repeat(41) } })
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('A tag must be at most 40 characters.')).toBeInTheDocument()
    expect(requestImportText).not.toHaveBeenCalled()
  })

  it('clears the tag error once the field is edited', async () => {
    setup({ page: { ...PAGE, selection: 'Olá.' } })
    const field = await screen.findByLabelText('Tags (comma-separated)')
    fireEvent.change(field, { target: { value: 'x'.repeat(41) } })
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('A tag must be at most 40 characters.')).toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'news' } })

    expect(screen.queryByText('A tag must be at most 40 characters.')).not.toBeInTheDocument()
  })
})
