import Link from 'next/link'
import { login, requestPasswordReset } from '@/app/auth/actions'

type Props = {
  searchParams: Promise<{
    error?: string
    reset_sent?: string
    reset_error?: string
    notice?: string
    email?: string
    on_roster?: string
  }>
}

export default async function LoginPage({ searchParams }: Props) {
  const {
    error,
    reset_sent: resetSent,
    reset_error: resetError,
    notice,
    email,
    on_roster: onRoster,
  } = await searchParams
  // Supabase returns "Invalid login credentials" when either the email
  // has no account or the password is wrong. The login action pairs that
  // error with on_roster=1|0 so we can show a targeted hint.
  const isBadCreds = error?.toLowerCase().includes('invalid login credentials')
  const signupHref = email
    ? `/auth/signup?email=${encodeURIComponent(email)}`
    : '/auth/signup'
  return (
    <div className="max-w-sm mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-6">Log in</h1>
      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {isBadCreds && onRoster === '1' && (
            <p className="mt-1">
              Your email is on the club roster but doesn&apos;t have an account
              yet —{' '}
              <Link href={signupHref} className="underline font-medium">
                sign up here
              </Link>
              .
            </p>
          )}
          {isBadCreds && onRoster === '0' && (
            <p className="mt-1">
              We don&apos;t have this email on the club roster. Your membership
              may be under a different email — check any past club
              correspondence, or contact the tournament director to update it.
            </p>
          )}
          {isBadCreds && onRoster === undefined && (
            <p className="mt-1">
              If you&apos;ve never logged in before,{' '}
              <Link href="/auth/signup" className="underline font-medium">
                sign up here
              </Link>
              .
            </p>
          )}
        </div>
      )}
      {resetSent && (
        <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          <p>
            A password reset link has been sent to <strong>{resetSent}</strong>.
            Check your inbox (and spam folder).
          </p>
          <p className="mt-1">
            If you&apos;ve never signed up, the email won&apos;t arrive —{' '}
            <Link href="/auth/signup" className="underline font-medium">
              sign up instead
            </Link>
            .
          </p>
        </div>
      )}
      {resetError && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>
            We couldn&apos;t send a password reset link
            {email ? <> to <strong>{email}</strong></> : null}: {resetError}
          </p>
          <p className="mt-1">
            Try again in a few minutes, or contact the tournament director if
            this keeps happening.
          </p>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <p>{notice}</p>
        </div>
      )}
      <form className="space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            defaultValue={email ?? ''}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        {/* "Log in" appears FIRST in DOM order so Enter implicitly submits
            to login. flex-col-reverse keeps the visual layout the user
            expects (Forgot password? above the Log in button). */}
        <div className="flex flex-col-reverse gap-3">
          <button
            type="submit"
            formAction={login}
            className="w-full rounded bg-[var(--color-accent)] text-white py-2 hover:opacity-90"
          >
            Log in
          </button>
          <div className="text-right">
            {/* Submits the same form to the reset action — uses the email above.
                formNoValidate so the required password field doesn't block it. */}
            <button
              type="submit"
              formAction={requestPasswordReset}
              formNoValidate
              className="text-sm underline text-[var(--color-muted)] hover:opacity-80"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </form>
      <p className="mt-4 text-sm text-[var(--color-muted)]">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="underline">Sign up</Link>
      </p>
    </div>
  )
}
