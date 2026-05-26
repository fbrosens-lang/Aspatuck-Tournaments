import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  reported: 'bg-blue-100 text-blue-800',
  disputed: 'bg-red-100 text-red-800',
}
const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting players',
  reported: 'Awaiting opponent confirm',
  disputed: 'Disputed — resolve',
}

export default async function DirectorDashboardPage() {
  const { userId, role } = await getSession()
  if (!userId) redirect('/auth/login?error=Please+log+in')
  if (role !== 'tournament_director' && role !== 'site_admin') {
    return (
      <div className="max-w-md mx-auto py-12">
        <h1 className="text-2xl font-semibold mb-3">Tournament director</h1>
        <p className="text-red-700">
          You need the tournament-director role to use this dashboard. Ask a site
          admin to grant it.
        </p>
      </div>
    )
  }

  const supabase = await createClient()

  const { data: tdRows } = await supabase
    .from('tournament_directors')
    .select('tournament_id')
    .eq('user_id', userId)
  const tdTournamentIds = tdRows?.map((r) => r.tournament_id) ?? []

  let tournamentQuery = supabase
    .from('tournaments')
    .select('id, name, start_date, end_date, status, kind, draw_status')
    .order('start_date', { ascending: false })
  if (role !== 'site_admin') {
    tournamentQuery =
      tdTournamentIds.length > 0
        ? tournamentQuery.in('id', tdTournamentIds)
        : tournamentQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  }
  const { data: tournaments } = await tournamentQuery

  const { data: tdMatches } = await supabase.rpc('td_managed_matches')

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Tournament director</h1>
          <p className="text-[var(--color-muted)] mt-1">
            Your dashboard for the tournaments you run.
          </p>
        </div>
        <Link
          href="/tournaments/new"
          className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
        >
          New tournament
        </Link>
      </header>

      <section>
        <h2 className="text-xl font-medium mb-3">
          Matches needing attention{' '}
          <span className="text-sm text-[var(--color-muted)] font-normal">
            ({tdMatches?.length ?? 0})
          </span>
        </h2>
        {!tdMatches || tdMatches.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
            No open matches.
          </div>
        ) : (
          <ul className="space-y-2">
            {tdMatches.map((m: {
              match_id: string
              tournament_id: string
              tournament_name: string
              round: number
              side_a_label: string
              side_b_label: string
              match_status: string
              deadline: string | null
            }) => (
              <li
                key={m.match_id}
                className="rounded border border-[var(--color-border)] bg-white"
              >
                <Link
                  href={`/matches/${m.match_id}`}
                  className="flex items-center justify-between p-3 hover:bg-zinc-50"
                >
                  <div>
                    <p className="font-medium">
                      {m.side_a_label} vs {m.side_b_label}
                      <span
                        className={`ml-2 text-xs rounded px-1.5 py-0.5 ${STATUS_BADGE[m.match_status] ?? 'bg-zinc-100 text-[var(--color-muted)]'}`}
                      >
                        {STATUS_LABEL[m.match_status] ?? m.match_status}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--color-muted)] mt-0.5">
                      {m.tournament_name} · Round {m.round}
                      {m.deadline && (
                        <> · due {new Date(m.deadline).toLocaleString()}</>
                      )}
                    </p>
                  </div>
                  <span className="text-sm text-[var(--color-accent)] hover:underline">
                    Enter / override →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-medium mb-3">Your tournaments</h2>
        {!tournaments || tournaments.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--color-muted)]">
            You aren&apos;t directing any tournaments yet.{' '}
            <Link href="/tournaments/new" className="underline text-[var(--color-accent)]">
              Create one →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {tournaments.map((t) => (
              <li
                key={t.id}
                className="rounded border border-[var(--color-border)] bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <Link
                      href={`/tournaments/${t.id}`}
                      className="text-lg font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                    <p className="text-sm text-[var(--color-muted)]">
                      {t.start_date} – {t.end_date}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mt-1">
                      {t.kind} · Status: {t.status} · Draw: {t.draw_status}
                    </p>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <Link
                      href={`/tournaments/${t.id}/manage`}
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
                    >
                      Manage
                    </Link>
                    <Link
                      href={`/tournaments/${t.id}/participants`}
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
                    >
                      Participants
                    </Link>
                    <Link
                      href={`/tournaments/${t.id}/entries`}
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
                    >
                      Entries
                    </Link>
                    <Link
                      href={`/tournaments/${t.id}/draw`}
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50 text-[var(--color-accent)]"
                    >
                      Draw
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
