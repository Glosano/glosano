import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { intlLocale, useI18n } from '@/lib/i18n'

export function RootLayout() {
  const { language } = useI18n()
  useEffect(() => {
    // Only the language is reflected here; storing it is up to whoever made an explicit choice.
    document.documentElement.lang = intlLocale(language)
  }, [language])
  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-50">
      <Outlet />
    </div>
  )
}
