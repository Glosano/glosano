import { createContext } from 'react'

export interface ReviewNavigation {
  lessonTitle?: string | null
  choose: () => void
  returnToLesson?: () => void
  practice: (ids: string[]) => void
}

export const ReviewNavigationContext = createContext<ReviewNavigation | null>(null)
