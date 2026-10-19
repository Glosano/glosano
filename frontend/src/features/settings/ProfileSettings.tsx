import { useState } from 'react'

import { meApi } from '@/api/me'
import { getApiErrorKey } from '@/api/client'
import { useTranslation, msg } from '@/lib/i18n'
import { useUserStore } from '@/stores/userStore'
import { buttonClass, FormMessage, inputClass, SettingsSection } from './shared'
import { useApplyProfile } from './useApplyProfile'

export function ProfileSettings() {
  const t = useTranslation()
  const user = useUserStore((s) => s.user)
  const applyProfile = useApplyProfile()
  const [name, setName] = useState(user?.display_name ?? '')
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState<'profile' | 'password' | null>(null)
  const [profileError, setProfileError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [saved, setSaved] = useState<'profile' | 'password' | null>(null)

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setProfileError('')
    setSaved(null)
    if (!name.trim() || name.trim().length > 80) {
      setProfileError(msg('Enter a display name of 1 to 80 characters.'))
      return
    }
    setPending('profile')
    try {
      await applyProfile(await meApi.updateProfile({ display_name: name.trim() }))
      setSaved('profile')
    } catch (error) {
      setProfileError(getApiErrorKey(error))
    } finally {
      setPending(null)
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    setPasswordError('')
    setSaved(null)
    if (!current) {
      setPasswordError(msg('Enter your current password.'))
      return
    }
    if (password.length < 10 || password.length > 128) {
      setPasswordError(msg('Password must contain 10 to 128 characters.'))
      return
    }
    if (password !== confirm) {
      setPasswordError(msg('Passwords do not match.'))
      return
    }
    setPending('password')
    try {
      await meApi.changePassword({ current_password: current, new_password: password })
      setCurrent('')
      setPassword('')
      setConfirm('')
      setSaved('password')
    } catch (error) {
      setPasswordError(getApiErrorKey(error))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t('Profile')}>
        <div
          aria-hidden="true"
          className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-xl font-semibold"
        >
          {user?.display_name
            .trim()
            .split(/\s+/)
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <form noValidate onSubmit={(e) => void saveProfile(e)} className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="profile-name">
            {t('Display name')}
            <input
              id="profile-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <div>
            <label className="block text-sm font-medium" htmlFor="profile-email">
              {t('Email')}
              <input
                id="profile-email"
                className={`${inputClass} text-muted-foreground`}
                value={user?.email ?? ''}
                readOnly
                type="email"
                autoComplete="email"
              />
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t('Email cannot be changed.')}</p>
          </div>
          <FormMessage
            error={profileError && t(profileError)}
            success={saved === 'profile' ? t('Saved') : ''}
          />
          <button className={buttonClass} disabled={pending !== null}>
            {t(pending === 'profile' ? msg('Saving…') : msg('Save profile'))}
          </button>
        </form>
      </SettingsSection>
      <SettingsSection title={t('Change password')}>
        <form noValidate onSubmit={(e) => void savePassword(e)} className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="password-current">
            {t('Current password')}
            <input
              id="password-current"
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label className="block text-sm font-medium" htmlFor="password-new">
            {t('New password')}
            <input
              id="password-new"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              maxLength={128}
            />
          </label>
          <label className="block text-sm font-medium" htmlFor="password-confirm">
            {t('Confirm new password')}
            <input
              id="password-confirm"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t('Password must contain 10 to 128 characters.')}
          </p>
          <FormMessage
            error={passwordError && t(passwordError)}
            success={
              saved === 'password'
                ? t('Password changed. Sign in again on your other devices.')
                : ''
            }
          />
          <button className={buttonClass} disabled={pending !== null}>
            {t(pending === 'password' ? msg('Saving…') : msg('Change password'))}
          </button>
        </form>
      </SettingsSection>
    </div>
  )
}
