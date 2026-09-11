import type { ReactNode } from 'react'

export const inputClass =
  'mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
export const buttonClass =
  'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  if (success)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {success}
      </p>
    )
  return null
}
