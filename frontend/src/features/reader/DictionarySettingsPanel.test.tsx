import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/externalDictionaries', () => ({
  externalDictionariesApi: {
    list: vi.fn(),
    setLayout: vi.fn(),
    createCustom: vi.fn(),
    updateCustom: vi.fn(),
    deleteCustom: vi.fn(),
  },
}))

import { ApiError } from '@/api/client'
import { externalDictionariesApi, type ExternalDictionary } from '@/api/externalDictionaries'
import { DictionarySettingsPanel } from './DictionarySettingsPanel'

const dict = (over: Partial<ExternalDictionary>): ExternalDictionary => ({
  ref: 'reverso',
  kind: 'builtin',
  name: 'Reverso',
  url_template: 'https://example.com/{word}',
  word_encoding: 'default',
  custom_id: null,
  all_languages: false,
  ...over,
})

const reverso = dict({})
const google = dict({ ref: 'google', name: 'Google' })
const deepl = dict({ ref: 'deepl', name: 'DeepL' })
const mine = dict({
  ref: 'custom:7',
  kind: 'custom',
  name: 'Mine',
  custom_id: '7',
  url_template: 'https://mine.example/{word}',
})

function renderPanel(onDone: () => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DictionarySettingsPanel lang="pt" target="ru" onDone={onDone} />
    </QueryClientProvider>,
  )
}

describe('DictionarySettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(externalDictionariesApi.list).mockResolvedValue({
      visible: [reverso, google, mine],
      available: [deepl],
    })
    vi.mocked(externalDictionariesApi.setLayout).mockResolvedValue({
      visible: [],
      available: [],
    })
  })

  it('marks its root so card hotkeys stay inert and calls onDone', async () => {
    const onDone = vi.fn()
    const { container } = renderPanel(onDone)
    await screen.findByLabelText('Скрыть «Reverso»')
    expect(container.querySelector('[data-reader-panel-popover]')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('first row has no up button and the last row no down button', async () => {
    renderPanel()
    await screen.findByLabelText('Скрыть «Reverso»')
    expect(screen.queryByLabelText('Выше «Reverso»')).toBeNull()
    expect(screen.getByLabelText('Ниже «Reverso»')).toBeInTheDocument()
    expect(screen.getByLabelText('Выше «Mine»')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ниже «Mine»')).toBeNull()
  })

  it('hide moves a dictionary to available', async () => {
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Скрыть «Google»'))
    await waitFor(() =>
      expect(externalDictionariesApi.setLayout).toHaveBeenCalledWith('pt', 'ru', [
        'reverso',
        'custom:7',
      ]),
    )
  })

  it('move up swaps order', async () => {
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Выше «Google»'))
    await waitFor(() =>
      expect(externalDictionariesApi.setLayout).toHaveBeenCalledWith('pt', 'ru', [
        'google',
        'reverso',
        'custom:7',
      ]),
    )
  })

  it('move down swaps order', async () => {
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Ниже «Google»'))
    await waitFor(() =>
      expect(externalDictionariesApi.setLayout).toHaveBeenCalledWith('pt', 'ru', [
        'reverso',
        'custom:7',
        'google',
      ]),
    )
  })

  it('show appends to visible', async () => {
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Показать «DeepL»'))
    await waitFor(() =>
      expect(externalDictionariesApi.setLayout).toHaveBeenCalledWith('pt', 'ru', [
        'reverso',
        'google',
        'custom:7',
        'deepl',
      ]),
    )
  })

  it('create sends the current pair', async () => {
    vi.mocked(externalDictionariesApi.createCustom).mockResolvedValue(mine)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить свой словарь' }))
    await userEvent.type(screen.getByLabelText('Название'), 'Priberam')
    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://dicionario.priberam.org/{word}')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(externalDictionariesApi.createCustom).toHaveBeenCalledWith({
        name: 'Priberam',
        url_template: 'https://dicionario.priberam.org/{word}',
        all_languages: false,
        source_language_code: 'pt',
        target_language_code: 'ru',
      }),
    )
  })

  it('all languages checkbox is sent', async () => {
    vi.mocked(externalDictionariesApi.createCustom).mockResolvedValue(mine)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить свой словарь' }))
    await userEvent.type(screen.getByLabelText('Название'), 'Any')
    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://any.example/{word}')
    await userEvent.click(screen.getByLabelText('Для всех языков'))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(externalDictionariesApi.createCustom).toHaveBeenCalledWith(
        expect.objectContaining({ all_languages: true }),
      ),
    )
  })

  it('save is disabled until name and link are filled', async () => {
    vi.mocked(externalDictionariesApi.createCustom).mockResolvedValue(mine)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить свой словарь' }))
    const save = screen.getByRole('button', { name: 'Сохранить' })
    expect(save).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Название'), '   ')
    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://any.example/{word}')
    expect(save).toBeDisabled()

    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.type(screen.getByLabelText('Название'), 'Any')
    await userEvent.clear(screen.getByLabelText('Ссылка'))
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('   ')
    expect(save).toBeDisabled()
    expect(externalDictionariesApi.createCustom).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://any.example/{word}')
    expect(save).toBeEnabled()
  })

  it('server validation code shows a readable message', async () => {
    vi.mocked(externalDictionariesApi.createCustom).mockRejectedValue(
      new ApiError(422, 'placeholder_in_host'),
    )
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить свой словарь' }))
    await userEvent.type(screen.getByLabelText('Название'), 'Bad')
    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://{word}.example/')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '{word} не может стоять в адресе сайта',
    )
  })

  it('unknown error falls back to a generic message', async () => {
    vi.mocked(externalDictionariesApi.createCustom).mockRejectedValue(new ApiError(500, 'boom'))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить свой словарь' }))
    await userEvent.type(screen.getByLabelText('Название'), 'X')
    await userEvent.click(screen.getByLabelText('Ссылка'))
    await userEvent.paste('https://x.example/{word}')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить')
  })

  it('edit pre-fills the form and updates with the current pair', async () => {
    vi.mocked(externalDictionariesApi.updateCustom).mockResolvedValue(mine)
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Изменить «Mine»'))
    expect(screen.getByLabelText('Название')).toHaveValue('Mine')
    expect(screen.getByLabelText('Ссылка')).toHaveValue('https://mine.example/{word}')
    await userEvent.type(screen.getByLabelText('Название'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(externalDictionariesApi.updateCustom).toHaveBeenCalledWith('7', {
        name: 'Mine2',
        url_template: 'https://mine.example/{word}',
        all_languages: false,
        source_language_code: 'pt',
        target_language_code: 'ru',
      }),
    )
  })

  it('delete asks for confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(externalDictionariesApi.deleteCustom).mockResolvedValue(undefined)
    renderPanel()
    await userEvent.click(await screen.findByLabelText('Изменить «Mine»'))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить словарь' }))
    expect(confirm).toHaveBeenCalledWith('Удалить «Mine» во всех языках?')
    expect(externalDictionariesApi.deleteCustom).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить словарь' }))
    await waitFor(() => expect(externalDictionariesApi.deleteCustom).toHaveBeenCalledWith('7'))
    confirm.mockRestore()
  })
})
