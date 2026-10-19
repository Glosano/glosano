import type { ReactNode } from 'react'

import glosanoLogo from '@/assets/glosano-logo.webp'

import { AuthLanguagePicker } from './AuthLanguagePicker'

/** Login and registration screens: the logo and form centred, the interface language above. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background p-4">
      <div className="flex justify-end">
        <AuthLanguagePicker />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <img src={glosanoLogo} alt="Glosano" className="w-32 md:w-40" />
        {children}
      </div>
    </div>
  )
}
