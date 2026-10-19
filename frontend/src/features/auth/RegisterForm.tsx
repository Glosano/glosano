import { useI18n, msg } from '@/lib/i18n'
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { authApi } from '@/api/auth'
import { ApiError } from '@/api/client'
import { meApi } from '@/api/me'
import { useUserStore } from '@/stores/userStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RegisterForm() {
  const { language, t } = useI18n()
  const navigate = useNavigate()
  const setUser = useUserStore((s) => s.setUser)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!displayName.trim() || [...displayName.trim()].length > 80) {
      setError(msg('Enter a display name of 1 to 80 characters.'))
      return
    }
    const emailInput = e.currentTarget.querySelector<HTMLInputElement>('[type="email"]')
    if (!email.trim() || emailInput?.validity.typeMismatch) {
      setError(msg('Enter a valid email address.'))
      return
    }
    if ([...password].length < 10 || [...password].length > 128) {
      setError(msg('Password must contain 10 to 128 characters.'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await authApi.register({
        display_name: displayName,
        email,
        password,
        ui_language: language,
      })
      const me = await meApi.get()
      setUser(me)
      await navigate({ to: '/onboarding' })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError(msg('This email is already in use'))
        else if (err.status === 403)
          setError(msg('Registration has been disabled by the administrator'))
        else if (err.status === 422)
          setError(msg('The password must contain at least 10 characters'))
        else if (err.status === 429) setError(msg('Too many attempts. Try again later.'))
        else setError(msg('Could not create your account'))
      } else {
        setError(msg('Could not create your account'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
      <h1 className="text-3xl font-semibold text-center">{t('Sign up', { context: 'title' })}</h1>
      <div className="space-y-2">
        <Label htmlFor="name">{t('Display name')}</Label>
        <Input
          id="name"
          autoComplete="name"
          required
          maxLength={80}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t('Email', { context: 'auth' })}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('Password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
        <p className="text-xs text-muted-foreground">{t('At least 10 characters')}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting}>
        {t('Create account')}
      </Button>
      <p className="text-sm text-center text-muted-foreground">
        {t('Already have an account?')}{' '}
        <Link to="/login" className="text-primary hover:underline">
          {t('Log in', { context: 'link' })}
        </Link>
      </p>
    </form>
  )
}
