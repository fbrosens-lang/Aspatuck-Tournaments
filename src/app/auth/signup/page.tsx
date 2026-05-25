import Link from 'next/link'
import { signup } from '@/app/auth/actions'

type Props = { searchParams: Promise<{ error?: string }> }

export default async function SignupPage({ searchParams }: Props) {
  const { error } = await searchParams
  return (
    <div className="max-w-sm mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-6">Sign up</h1>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form action={signup} className="space-y-4">
        <label className="block">
          <span className="text-sm">Full name</span>
          <input
            type="text"
            name="full_name"
            required
            autoComplete="name"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
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
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-[var(--color-accent)] text-white py-2 hover:opacity-90"
        >
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--color-muted)]">
        Already have an account?{' '}
        <Link href="/auth/login" className="underline">Log in</Link>
      </p>
    </div>
  )
}
