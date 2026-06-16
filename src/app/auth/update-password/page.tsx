import { redirect } from 'next/navigation'
import { updatePassword } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'
import { SubmitButton } from '@/components/SubmitButton'

type Props = { searchParams: Promise<{ error?: string }> }

export default async function UpdatePasswordPage({ searchParams }: Props) {
  const { error } = await searchParams
  // The user lands here from the reset-link → /auth/callback → here, with a
  // valid session. If there's no session, the link expired or was already used.
  const supabase = await createClient()
  const { data, error: userErr } = await supabase.auth.getUser()
  if (userErr || !data.user) {
    redirect('/auth/login?error=Reset+link+expired.+Please+request+a+new+one.')
  }

  return (
    <div className="max-w-sm mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-2">Choose a new password</h1>
      <p className="mb-6 text-sm text-[var(--color-muted)]">
        Pick a password you haven&apos;t used before. At least 8 characters.
      </p>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form action={updatePassword} className="space-y-4">
        <label className="block">
          <span className="text-sm">New password</span>
          <input
            type="password"
            name="password"
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
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <SubmitButton
          variant="plain"
          className="w-full rounded bg-[var(--color-accent)] text-white py-2 hover:opacity-90"
          pendingLabel="Updating…"
        >
          Update password
        </SubmitButton>
      </form>
    </div>
  )
}
