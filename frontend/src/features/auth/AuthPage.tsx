import type { ReactNode } from 'react'

import { AuthLanguagePicker } from './AuthLanguagePicker'

/** Login and registration screens: the form centred, the interface language above it. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background p-4">
      <div className="flex justify-end">
        <AuthLanguagePicker />
      </div>
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </div>
  )
}
