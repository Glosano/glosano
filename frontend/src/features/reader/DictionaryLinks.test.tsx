import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/externalDictionaries', () => ({
  externalDictionariesApi: { list: vi.fn() },
}))

import { externalDictionariesApi, type ExternalDictionary } from '@/api/externalDictionaries'
import { DictionaryLinks } from './DictionaryLinks'

const dict = (over: Partial<ExternalDictionary>): ExternalDictionary => ({
  ref: 'reverso',
  kind: 'builtin',
  name: 'Reverso',
  url_template: 'https://context.reverso.net/translation/portuguese-russian/{word}',
  word_encoding: 'default',
  custom_id: null,
  all_languages: false,
  ...over,
})

function renderLinks(text = 'trem', onConfigure: () => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DictionaryLinks lang="pt" target="ru" text={text} onConfigure={onConfigure} />
    </QueryClientProvider>,
  )
}

describe('DictionaryLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a chip per visible dictionary with encoded href', async () => {
    vi.mocked(externalDictionariesApi.list).mockResolvedValue({
      visible: [dict({})],
      available: [],
    })
    renderLinks()
    const link = await screen.findByRole('link', { name: /Reverso/ })
    expect(link).toHaveAttribute(
      'href',
      'https://context.reverso.net/translation/portuguese-russian/trem',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(externalDictionariesApi.list).toHaveBeenCalledWith('pt', 'ru')
  })

  it('skips a dictionary whose template is unsafe', async () => {
    vi.mocked(externalDictionariesApi.list).mockResolvedValue({
      visible: [
        dict({
          ref: 'custom:1',
          kind: 'custom',
          name: 'Evil',
          url_template: 'javascript:alert(1)//{word}',
        }),
        dict({}),
      ],
      available: [],
    })
    renderLinks()
    await screen.findByRole('link', { name: /Reverso/ })
    expect(screen.queryByRole('link', { name: /Evil/ })).toBeNull()
  })

  it('shows heading and configure button when nothing is visible', async () => {
    vi.mocked(externalDictionariesApi.list).mockResolvedValue({ visible: [], available: [] })
    const onConfigure = vi.fn()
    renderLinks('trem', onConfigure)
    await waitFor(() => expect(externalDictionariesApi.list).toHaveBeenCalled())
    expect(screen.getByText('Словари')).toBeInTheDocument()
    screen.getByRole('button', { name: /Настроить/ }).click()
    expect(onConfigure).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders only heading and button while the request fails', async () => {
    vi.mocked(externalDictionariesApi.list).mockRejectedValue(new Error('boom'))
    renderLinks()
    await waitFor(() => expect(externalDictionariesApi.list).toHaveBeenCalled())
    expect(screen.getByTestId('word-card-dictionaries')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Настроить/ })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
