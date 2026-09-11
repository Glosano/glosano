import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import { useTranslation } from '@/lib/i18n'

interface Props {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: Props) {
  const t = useTranslation()
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    retry: false,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (data) {
      setUser(data)
      setHydratedUserId(data.id)
      if (data.needs_onboarding) {
        void navigate({ to: '/onboarding' })
      }
    }
  }, [data, setUser, navigate])

  useEffect(() => {
    if (isError) {
      const isUnauth = error instanceof ApiError && error.status === 401
      if (isUnauth) {
        void navigate({ to: '/login' })
      }
    }
  }, [isError, error, navigate])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">{t('Загрузка…')}</p>
      </div>
    )
  }
  if (isError && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <p role="alert">{t('Не удалось загрузить профиль.')}</p>
        <button className="rounded-lg border px-4 py-2" onClick={() => void refetch()}>
          {t('Повторить')}
        </button>
      </div>
    )
  }
  if (!data || data.needs_onboarding || hydratedUserId !== data.id) return null
  return <>{children}</>
}
