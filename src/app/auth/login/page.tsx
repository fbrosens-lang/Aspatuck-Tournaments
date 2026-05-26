import Link from 'next/link'
import { login, requestPasswordReset } from '@/app/auth/actions'

type Props = {
  searchParams: Promise<{ error?: string; reset_sent?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, reset_sent: resetSent } = await searchParams
  return (
    <div className="max-w-sm mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-6">Log in</h1>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {resetSent && (
        <p className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          A password reset link has been sent to <strong>{resetSent}</strong>.
          Check your inbox (and spam folder).
        </p>
      )}
      <form className="space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
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
