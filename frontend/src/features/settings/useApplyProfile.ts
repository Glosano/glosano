import { useQueryClient } from '@tanstack/react-query'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import { getUiLanguage, loadCatalog } from '@/lib/i18n'
import { isUiLanguage } from '@/lib/uiLanguages'

export function useApplyProfile() {
  const cache = useQueryClient()
  return async (user: MeResponse) => {
    const previous = useUserStore.getState().user
    // Cached translations, dictionaries and review cards are built for one UI and
    // one native language; either change makes them stale.
    const languageChanged =
      getUiLanguage() !== user.ui_language_code ||
      (previous !== null && previous.native_language_code !== user.native_language_code)
    await cache.cancelQueries({ queryKey: ['me'], exact: true })
    if (languageChanged) await cache.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    // setUser makes the user store's subscriber switch the interface language (and log a failed
    // load). Here we only wait for that catalog, so the refetches below run in the new language;
    // if it cannot load, the caches still refresh, in the language that stays active.
    useUserStore.getState().setUser(user)
    if (isUiLanguage(user.ui_language_code))
      await loadCatalog(user.ui_language_code).catch(() => undefined)
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
