import { api } from './client'
import type { LearningLanguageCode } from '@/lib/languages'

export type UserRole = 'learner' | 'admin'

export interface MeResponse {
  ai_enabled?: boolean
  id: string
  email: string
  role: UserRole
  display_name: string
  ui_language_code: string
  learning_languages: LearningLanguageCode[]
  last_learning_language_code: LearningLanguageCode | null
  needs_onboarding: boolean
  onboarded_at: string | null
  preferred_translation_language_code?: string
  daily_goal_minutes?: number
  daily_goal_reviews?: number
}

export interface PreferencesPayload {
  ui_language: 'en' | 'ru'
  learning_languages: LearningLanguageCode[]
  daily_goal_minutes: number
  daily_goal_reviews: number
}

export interface OnboardingPayload {
  ui_language: string
  learning_languages: LearningLanguageCode[]
  translation_language: string
}

export const meApi = {
  get: () => api<MeResponse>('/me'),
  updateProfile: (payload: { display_name: string }) =>
    api<MeResponse>('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  updatePreferences: (payload: PreferencesPayload) =>
    api<MeResponse>('/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api<{ ok: boolean }>('/me/password', { method: 'POST', body: JSON.stringify(payload) }),
  export: () => api<Record<string, unknown>>('/me/export'),
  onboarding: (payload: OnboardingPayload) =>
    api<{ ok: boolean; redirect: string }>('/me/onboarding', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  setLastLanguage: (language_code: LearningLanguageCode) =>
    api<{ ok: boolean }>('/me/last-language', {
      method: 'PATCH',
      body: JSON.stringify({ language_code }),
    }),
  addLearningLanguage: (language_code: LearningLanguageCode) =>
    api<MeResponse>('/me/learning-languages', {
      method: 'POST',
      body: JSON.stringify({ language_code }),
    }),
  delete: (password: string) =>
    api<{ ok: boolean }>('/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),
}
