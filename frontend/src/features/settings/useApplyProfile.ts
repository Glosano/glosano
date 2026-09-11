import { useQueryClient } from '@tanstack/react-query'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import { getUiLanguage, setUiLanguage } from '@/lib/i18n'

export function useApplyProfile() {
  const cache = useQueryClient()
  return async (user: MeResponse) => {
    const languageChanged = getUiLanguage() !== user.ui_language_code
    await cache.cancelQueries({ queryKey: ['me'], exact: true })
    if (languageChanged) await cache.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    useUserStore.getState().setUser(user)
    if (user.ui_language_code === 'en' || user.ui_language_code === 'ru')
      setUiLanguage(user.ui_language_code)
    cache.setQueryData(['me'], user)
    if (languageChanged) {
      await cache.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    } else {
      await cache.invalidateQueries({
        predicate: (q) =>
          (typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('review')) ||
          q.queryKey[0] === 'stats',
      })
    }
  }
}
