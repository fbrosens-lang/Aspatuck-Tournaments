import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import { addGuest } from './actions'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

export default async function ParticipantsPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  if (!(await isTdOfTournament(id))) {
    redirect(`/tournaments/${id}`)
  }
  const supabase = await createClient()
  const { data: participants } = await supabase
    .from('participants')
    .select('id, kind, display_name, email, date_of_birth, created_at')
    .eq('tournament_id', id)
    .order('created_at')

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/tournaments/${id}`}
          className="text-sm text-[var(--color-muted)] hover:underline"
        >
          ← Tournament
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Participants</h1>
        <p className="text-[var(--color-muted)] mt-1">
          Members are added automatically when they register (or when you enter them).
          Add guest participants (non-account players) here.
        </p>
      </header>

      <section className="bg-white border border-[var(--color-border)] rounded p-4">
        <h2 className="font-medium mb-3">Add a guest participant</h2>
        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 mb-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {ok && (
          <p className="rounded border border-green-300 bg-green-50 px-3 py-2 mb-3 text-sm text-green-700">
            Guest added.
          </p>
        )}
        <form action={addGuest} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <input type="hidden" name="tournament_id" value={id} />
          <label className="block sm:col-span-2">
            <span className="text-sm">Display name</span>
            <input
              name="name"
              required
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">Email (optional)</span>
            <input
              type="email"
              name="email"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">Date of birth (optional)</span>
            <input
              type="date"
              name="dob"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-4 justify-self-start"
          >
            Add guest
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-medium mb-3">
          All participants{' '}
          <span className="text-sm text-[var(--color-muted)] font-normal">
            ({participants?.length ?? 0})
          </span>
        </h2>
        {!participants || participants.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--color-muted)]">
            No participants yet.
          </div>
        ) : (
          <table className="w-full text-sm bg-white border border-[var(--color-border)] rounded">
            <thead className="text-left text-[var(--color-muted)] uppercase text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">DOB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {participants.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">{p.display_name}</td>
                  <td className="px-4 py-2 text-[var(--color-muted)]">{p.kind}</td>
                  <td className="px-4 py-2 text-[var(--color-muted)]">{p.email ?? ''}</td>
                  <td className="px-4 py-2 text-[var(--color-muted)]">{p.date_of_birth ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
