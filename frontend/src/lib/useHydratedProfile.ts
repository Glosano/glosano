import { useEffect, useState } from 'react'

import type { MeResponse } from '@/api/me'
import { useUserStore } from '@/stores/userStore'

import { whenUiLanguageLoaded } from './i18n'

/**
 * Puts a fetched profile into the user store and reports when it is in place: the store holds it
 * and the interface is in its language, or that language failed to load and the current one
 * stays. Rendering only then keeps a device whose browser language differs from the profile
 * from showing the browser language first, and starts the page's queries in the right language.
 */
export function useHydratedProfile(profile: MeResponse | undefined): boolean {
  const setUser = useUserStore((s) => s.setUser)
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setUser(profile)
    let current = true
    void whenUiLanguageLoaded(profile.ui_language_code).then(() => {
      if (current) setHydratedUserId(profile.id)
    })
    return () => {
      current = false
    }
  }, [profile, setUser])

  return profile !== undefined && hydratedUserId === profile.id
}
