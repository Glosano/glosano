import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { requestStatus, type Status } from '../../lib/messages'
import { requestHostPermission } from '../../lib/permissions'
import { getSettings } from '../../lib/settings'
import App from './App'

// ESM namespaces cannot be spied on in Vitest; mock the modules instead.
vi.mock('../../lib/messages')
vi.mock('../../lib/permissions')

const ME = { display_name: 'Ana', learning_languages: ['pt'], last_learning_language_code: 'pt', needs_onboarding: false }

describe('Options', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requestStatus).mockResolvedValue({ status: 'unconfigured' })
  })

  it('rejects an invalid address without asking for access', async () => {
    const request = vi.mocked(requestHostPermission).mockResolvedValue(true)
    render(<App />)
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'glosano.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(screen.getByText('Enter a full http:// or https:// address.')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('saves the origin after access is granted and shows the connection', async () => {
    vi.mocked(requestHostPermission).mockResolvedValue(true)
    vi.mocked(requestStatus)
      .mockResolvedValueOnce({ status: 'unconfigured' })
      .mockResolvedValueOnce({ status: 'ready', origin: 'https://g.example.com', me: { display_name: 'Ana', learning_languages: ['pt'], last_learning_language_code: 'pt', needs_onboarding: false } })
    render(<App />)
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'https://g.example.com/learn')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(await screen.findByText('Connected as Ana.')).toBeInTheDocument()
    expect((await getSettings()).instanceOrigin).toBe('https://g.example.com')
  })

  it('does not save when access is denied', async () => {
    vi.mocked(requestHostPermission).mockResolvedValue(false)
    render(<App />)
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'https://g.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(await screen.findByText('Access was not granted. The address was not saved.')).toBeInTheDocument()
    expect(await fakeBrowser.storage.local.get('instanceOrigin')).toEqual({})
  })

  it('shows an error instead of hanging on "Checking..." when the post-save check fails', async () => {
    vi.mocked(requestHostPermission).mockResolvedValue(true)
    vi.mocked(requestStatus)
      .mockResolvedValueOnce({ status: 'unconfigured' })
      .mockRejectedValueOnce(new Error('network down'))
    render(<App />)
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'https://g.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(await screen.findByText('Something went wrong (Error: network down).')).toBeInTheDocument()
    expect(screen.queryByText('Checking connection…')).not.toBeInTheDocument()
  })

  it('keeps the newer connected status when a stale mount-time check resolves late', async () => {
    let resolveMountStatus!: (status: Status) => void
    const mountStatus = new Promise<Status>((resolve) => {
      resolveMountStatus = resolve
    })
    vi.mocked(requestHostPermission).mockResolvedValue(true)
    vi.mocked(requestStatus)
      .mockReturnValueOnce(mountStatus) // the mount-time check: left pending on purpose
      .mockResolvedValueOnce({ status: 'ready', origin: 'https://g.example.com', me: ME }) // the post-save check

    render(<App />)
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'https://g.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(await screen.findByText('Connected as Ana.')).toBeInTheDocument()

    // The stale mount-time check finally resolves after the newer, successful submit.
    resolveMountStatus({ status: 'unconfigured' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Connected as Ana.')).toBeInTheDocument()
  })

  it('still updates status after a save under StrictMode', async () => {
    vi.mocked(requestHostPermission).mockResolvedValue(true)
    // In dev, StrictMode mounts the data-fetching effect twice (setup -> cleanup ->
    // setup), so the mount-time requestStatus() call fires twice before the
    // post-save call: queue a result for each of those three calls.
    vi.mocked(requestStatus)
      .mockResolvedValueOnce({ status: 'unconfigured' })
      .mockResolvedValueOnce({ status: 'unconfigured' })
      .mockResolvedValueOnce({ status: 'ready', origin: 'https://g.example.com', me: ME })
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await userEvent.type(await screen.findByLabelText('Glosano address'), 'https://g.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Save and allow access' }))
    expect(await screen.findByText('Connected as Ana.')).toBeInTheDocument()
  })
})
