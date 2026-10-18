import { api } from './client'

export type WordEncoding = 'default' | 'no_slash'

export interface ExternalDictionary {
  ref: string
  kind: 'builtin' | 'custom'
  name: string
  url_template: string
  word_encoding: WordEncoding
  custom_id: string | null
  all_languages: boolean
}

export interface ExternalDictionaries {
  visible: ExternalDictionary[]
  available: ExternalDictionary[]
}

export interface CustomDictionaryPayload {
  name: string
  url_template: string
  all_languages: boolean
  source_language_code: string
  target_language_code: string
}

const pair = (src: string, dst: string) => new URLSearchParams({ src, dst }).toString()

export const externalDictionariesApi = {
  list: (src: string, dst: string) =>
    api<ExternalDictionaries>(`/api/dictionary/external?${pair(src, dst)}`),
  setLayout: (src: string, dst: string, visible: string[]) =>
    api<ExternalDictionaries>(`/api/dictionary/external/layout?${pair(src, dst)}`, {
      method: 'PUT',
      body: JSON.stringify({ visible }),
    }),
  createCustom: (p: CustomDictionaryPayload) =>
    api<ExternalDictionary>('/api/dictionary/external/custom', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  updateCustom: (id: string, p: CustomDictionaryPayload) =>
    api<ExternalDictionary>(`/api/dictionary/external/custom/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(p),
    }),
  deleteCustom: (id: string) =>
    api<void>(`/api/dictionary/external/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
