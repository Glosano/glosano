import { Link, Outlet } from '@tanstack/react-router'

import { AppTopBar } from '@/components/AppTopBar'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useTranslation, msg } from '@/lib/i18n'

export function SettingsLayout() {
  const t = useTranslation()
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background">
        <AppTopBar />
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <h1 className="mb-7 text-2xl font-semibold tracking-tight">{t('Settings')}</h1>
          <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:gap-10">
            <nav aria-label={t('Settings')} className="flex flex-wrap gap-1 self-start md:flex-col">
              {(
                [
                  ['/settings/profile', msg('Profile')],
                  ['/settings/preferences', msg('Preferences')],
                  ['/settings/data', msg('Data')],
                ] as const
              ).map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent [&.active]:bg-accent [&.active]:text-foreground"
                  activeProps={{ className: 'active', 'aria-current': 'page' }}
                >
                  {t(label)}
                </Link>
              ))}
            </nav>
            <div className="min-w-0">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}
