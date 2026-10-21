import { api } from './client'

export interface AISettings {
  revision: number
  source: 'database' | 'environment'
  enabled: boolean
  base_url: string
  model: string
  has_key: boolean
  force_disabled: boolean
  key_error: string | null
}
export interface AIDraft {
  revision: number
  enabled: boolean
  base_url: string
  model: string
  key_action: 'keep' | 'replace' | 'remove'
  api_key?: string
}
const path = '/api/admin/ai'
export const adminApi = {
  get: () => api<AISettings>(path),
  save: (body: AIDraft) => api<AISettings>(path, { method: 'PUT', body: JSON.stringify(body) }),
  test: (body: AIDraft) =>
    api<{ ok: boolean }>(`${path}/test`, { method: 'POST', body: JSON.stringify(body) }),
  models: (body: AIDraft) =>
    api<{ models: string[] }>(`${path}/models`, { method: 'POST', body: JSON.stringify(body) }),
}
