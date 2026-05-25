import Link from 'next/link'
import { login } from '@/app/auth/actions'

type Props = { searchParams: Promise<{ error?: string }> }

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams
  return (
    <div className="max-w-sm mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-6">Log in</h1>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form action={login} className="space-y-4">
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
        <button
          type="submit"
          className="w-full rounded bg-[var(--color-accent)] text-white py-2 hover:opacity-90"
        >
          Log in
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--color-muted)]">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="underline">Sign up</Link>
      </p>
    </div>
  )
}
