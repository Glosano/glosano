import { Link, useParams } from '@tanstack/react-router'

import { StatisticsDropdown } from '@/features/statistics/StatisticsDropdown'
import { useTranslation } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'

import { LanguagePicker } from './LanguagePicker'
import { AvatarMenu } from './AvatarMenu'

export function AppTopBar() {
  const t = useTranslation()
  const user = useUserStore((s) => s.user)
  const params = useParams({ strict: false }) as { lang?: string }
  const lang =
    params.lang ?? user?.last_learning_language_code ?? user?.learning_languages[0] ?? 'en'

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 max-w-screen-2xl flex-wrap items-center gap-2 px-3 py-2 md:h-16 md:flex-nowrap md:gap-6 md:px-6 md:py-0">
        <Link
          to="/learn/$lang/library"
          params={{ lang }}
          className="text-xl font-bold md:text-2xl tracking-tight"
        >
          Glosano
        </Link>
        <LanguagePicker />
        <nav className="order-last flex w-full items-center gap-0 md:order-none md:ml-4 md:w-auto md:gap-1">
          <Link
            to="/learn/$lang/library"
            params={{ lang }}
            className="rounded-md px-2 py-1.5 md:px-3 text-sm font-medium text-foreground hover:bg-accent [&.active]:border-b-2 [&.active]:border-primary"
            activeProps={{ className: 'active' }}
          >
            {t('Библиотека')}
          </Link>
          <Link
            to="/learn/$lang/vocabulary"
            params={{ lang }}
            search={{ tab: 'all' }}
            activeOptions={{ includeSearch: false }}
            className="rounded-md px-2 py-1.5 md:px-3 text-sm font-medium text-foreground hover:bg-accent [&.active]:border-b-2 [&.active]:border-primary"
            activeProps={{ className: 'active' }}
          >
            {t('Словарь')}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-1 md:gap-3">
          <StatisticsDropdown lang={lang} />
          <AvatarMenu />
        </div>
      </div>
    </header>
  )
}
