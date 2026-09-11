import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { useTranslation } from '@/lib/i18n'
import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/userStore'

export function IndexRoute() {
  const t = useTranslation()
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)
  const { data, isError, error } = useQuery({
    queryKey: ['me'],
    queryFn: meApi.get,
    retry: false,
  })

  useEffect(() => {
    if (data) {
      setUser(data)
      if (data.needs_onboarding) {
        void navigate({ to: '/onboarding', replace: true })
        return
      }
      const lang = data.last_learning_language_code ?? data.learning_languages[0]
      if (lang) {
        void navigate({
          to: '/learn/$lang/library',
          params: { lang },
          replace: true,
        })
      } else {
        void navigate({ to: '/onboarding', replace: true })
      }
    }
  }, [data, setUser, navigate])

  useEffect(() => {
    if (isError) {
      const isUnauth = error instanceof ApiError && error.status === 401
      if (isUnauth) {
        void navigate({ to: '/login', replace: true })
      }
    }
  }, [isError, error, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">{t('Загрузка…')}</p>
    </div>
  )
}
