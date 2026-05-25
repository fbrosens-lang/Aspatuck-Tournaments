import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createTournament } from '@/app/tournaments/actions'
import { TournamentRulesFields } from '@/components/TournamentRulesFields'

type Props = { searchParams: Promise<{ error?: string }> }

export default async function NewTournamentPage({ searchParams }: Props) {
  const { error } = await searchParams
  const { userId, role } = await getSession()
  if (!userId) redirect('/auth/login?error=Please+log+in')
  if (role !== 'tournament_director' && role !== 'site_admin') {
    return (
      <div className="max-w-md mx-auto py-12">
        <h1 className="text-2xl font-semibold mb-3">New tournament</h1>
        <p className="text-red-700">
          You need the tournament director role to create a tournament. Ask a site
          admin to grant it.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto py-6 space-y-4">
      <h1 className="text-2xl font-semibold">New tournament</h1>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form action={createTournament} className="space-y-4">
        <label className="block">
          <span className="text-sm">Name</span>
          <input
            name="name"
            required
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">Location</span>
          <input
            name="location"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">Start date</span>
            <input
              type="date"
              name="start_date"
              required
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">End date</span>
            <input
              type="date"
              name="end_date"
              required
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm">Registration deadline (optional)</span>
          <input
            type="datetime-local"
            name="registration_deadline"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>

        <TournamentRulesFields mode="create" />

        <button
          type="submit"
          className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
        >
          Create
        </button>
      </form>
    </div>
  )
}
