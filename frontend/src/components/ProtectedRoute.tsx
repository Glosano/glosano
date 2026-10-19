import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { meApi } from '@/api/me'
import { useTranslation } from '@/lib/i18n'
import { useHydratedProfile } from '@/lib/useHydratedProfile'

interface Props {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: Props) {
  const t = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    retry: false,
    staleTime: 30_000,
  })
  const hydrated = useHydratedProfile(data)

  useEffect(() => {
    if (data?.needs_onboarding) void navigate({ to: '/onboarding' })
  }, [data, navigate])

  useEffect(() => {
    if (isError) {
      const isUnauth = error instanceof ApiError && error.status === 401
      if (isUnauth) {
        void navigate({ to: '/login' })
      }
    }
  }, [isError, error, navigate])

  // Until the profile and its interface language are in place, the page waits behind this.
  if (isLoading || (data && !data.needs_onboarding && !hydrated)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">{t('Loading…')}</p>
      </div>
    )
  }
  if (isError && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <p role="alert">{t('Could not load your profile.')}</p>
        <button className="rounded-lg border px-4 py-2" onClick={() => void refetch()}>
          {t('Retry')}
        </button>
      </div>
    )
  }
  if (!data || data.needs_onboarding || !hydrated) return null
  return <>{children}</>
}
