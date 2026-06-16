import { redirect } from 'next/navigation'
import { formatDateUS } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import { changePassword, updateLoginEmail, updateProfile } from './actions'
import { SubmitButton } from '@/components/SubmitButton'

type Props = {
  searchParams: Promise<{
    error?: string
    ok?: string
    email_change_sent?: string
    email_changed?: string
    password_changed?: string
  }>
}

export default async function ProfilePage({ searchParams }: Props) {
  const {
    error,
    ok,
    email_change_sent: emailChangeSent,
    email_changed: emailChanged,
    password_changed: passwordChanged,
  } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?error=Please+log+in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, contact_email, date_of_birth, role')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div className="max-w-md mx-auto py-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profile</h1>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          Saved.
        </p>
      )}
      {emailChangeSent && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          A confirmation link was sent to <strong>{emailChangeSent}</strong>.
          Click it to finish changing your login email. Your password
          won&apos;t change. (If Secure Email Change is enabled on the project,
          you&apos;ll also need to confirm from your current email.)
        </p>
      )}
      {emailChanged && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Your login email is now <strong>{user.email}</strong>. Use this email
          and your existing password to log in next time — your password is
          unchanged.
        </p>
      )}
      {passwordChanged && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Password changed. Use the new password next time you log in — your
          email is unchanged.
        </p>
      )}

      <p className="text-sm text-[var(--color-muted)]">
        Role: <code>{profile?.role ?? 'unknown'}</code>
      </p>

      {/* ----- Login email ----- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Login email</h2>
        <p className="text-sm">
          You currently log in with{' '}
          <strong className="font-medium">{user.email}</strong>.
        </p>
        <form action={updateLoginEmail} className="space-y-3">
          <label className="block">
            <span className="text-sm">New email</span>
            <input
              type="email"
              name="new_email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <SubmitButton variant="primary" pendingLabel="Sending…">
            Send confirmation link
          </SubmitButton>
          <p className="text-xs text-[var(--color-muted)]">
            This is the email you use to log in. After you click the
            confirmation link, you&apos;ll sign in with the new email.{' '}
            <strong>Your password stays the same.</strong>
          </p>
        </form>
      </section>

      {/* ----- Password ----- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Password</h2>
        <form action={changePassword} className="space-y-3">
          <label className="block">
            <span className="text-sm">Current password</span>
            <input
              type="password"
              name="current_password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">New password</span>
            <input
              type="password"
              name="new_password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">Confirm new password</span>
            <input
              type="password"
              name="confirm_password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <SubmitButton variant="primary" pendingLabel="Changing…">
            Change password
          </SubmitButton>
          <p className="text-xs text-[var(--color-muted)]">
            We ask for your current password to confirm it&apos;s really you.{' '}
            <strong>Your login email stays the same.</strong>
          </p>
        </form>
      </section>

      {/* ----- Name & date of birth ----- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <form action={updateProfile} className="space-y-4">
          {/* contact_email is kept in sync with the login email by a DB trigger
              after the user confirms a change above; pass the current value
              through unchanged so the td_update_self_profile RPC is happy. */}
          <input
            type="hidden"
            name="contact_email"
            defaultValue={profile?.contact_email ?? user.email ?? ''}
          />
          <label className="block">
            <span className="text-sm">Full name</span>
            <input
              name="full_name"
              required
              defaultValue={profile?.full_name ?? ''}
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">
              Date of birth (required for some tournaments)
            </span>
            <input
              type="text"
              name="date_of_birth"
              defaultValue={formatDateUS(profile?.date_of_birth)}
              placeholder="MM/DD/YYYY"
              inputMode="numeric"
              autoComplete="bday"
              pattern="\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}"
              title="Type the date as MM/DD/YYYY (e.g. 03/14/1975)"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <SubmitButton variant="primary" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
      </section>
    </div>
  )
}
