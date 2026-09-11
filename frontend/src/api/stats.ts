import { api } from './client'

export interface StatsOverview {
  language_code: string
  date: string
  timezone: 'UTC'
  known_items_count: number
  tracked_items_count: number
  ignored_items_count: number
  tokens_read_today: number
  new_items_today: number
  learned_items_today: number
  reviews_completed_today: number
  due_reviews: number
  reading_tracking_started_at: string
}

export const statsApi = {
  overview: (lang: string) =>
    api<StatsOverview>(`/api/stats/overview?lang=${encodeURIComponent(lang)}`),
}
