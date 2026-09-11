import { createRoute, redirect } from '@tanstack/react-router'

import { DataSettings } from '@/features/settings/DataSettings'
import { PreferencesSettings } from '@/features/settings/PreferencesSettings'
import { ProfileSettings } from '@/features/settings/ProfileSettings'
import { SettingsLayout } from '@/features/settings/SettingsLayout'
import { rootRoute } from './__rootRoute'

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsLayout,
})
export const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' })
  },
})
export const settingsProfileRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/profile',
  component: ProfileSettings,
})
export const settingsPreferencesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/preferences',
  component: PreferencesSettings,
})
export const settingsDataRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/data',
  component: DataSettings,
})
