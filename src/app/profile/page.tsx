import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateProfile } from './actions'

type Props = { searchParams: Promise<{ error?: string; ok?: string }> }

export default async function ProfilePage({ searchParams }: Props) {
  const { error, ok } = await searchParams
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
    <div className="max-w-md mx-auto py-6 space-y-4">
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

      <p className="text-sm text-[var(--color-muted)]">
        Role: <code>{profile?.role ?? 'unknown'}</code>
      </p>

      <form action={updateProfile} className="space-y-4">
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
          <span className="text-sm">Contact email</span>
          <input
            type="email"
            name="contact_email"
            required
            defaultValue={profile?.contact_email ?? ''}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">
            Date of birth (required for some tournaments)
          </span>
          <input
            type="date"
            name="date_of_birth"
            defaultValue={profile?.date_of_birth ?? ''}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
        >
          Save
        </button>
      </form>
    </div>
  )
}
