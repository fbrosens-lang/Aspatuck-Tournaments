import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { acceptInvite, declineInvite } from '@/app/tournaments/entry-actions'

const PLAYER_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  reported: 'bg-blue-100 text-blue-800',
  disputed: 'bg-red-100 text-red-800',
}
const PLAYER_STATUS_LABEL: Record<string, string> = {
  pending: 'Needs result',
  reported: 'Confirm opponent’s report',
  disputed: 'Disputed',
}

const TD_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  reported: 'bg-blue-100 text-blue-800',
  disputed: 'bg-red-100 text-red-800',
}
const TD_STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting players',
  reported: 'Awaiting opponent confirm',
  disputed: 'Disputed — resolve',
}

type PlayerMatch = {
  match_id: string
  tournament_id: string
  tournament_name: string
  round: number
  opponent_label: string
  match_status: string
  deadline: string | null
}

type TdMatch = {
  match_id: string
  tournament_id: string
  tournament_name: string
  round: number
  side_a_label: string
  side_b_label: string
  match_status: string
  deadline: string | null
}

type PendingInvite = {
  team_id: string
  tournament_id: string
  tournament_name: string
  captain_name: string
}

export default async function HomePage() {
  const supabase = await createClient()
  const { userId, role } = await getSession()

  let myMatches: PlayerMatch[] | null = null
  let tdMatches: TdMatch[] | null = null
  let pendingInvites: PendingInvite[] = []
  if (userId) {
    const [{ data: mine }, { data: managed }] = await Promise.all([
      supabase.rpc('my_pending_matches'),
      role === 'tournament_director' || role === 'site_admin'
        ? supabase.rpc('td_managed_matches')
        : Promise.resolve({ data: null }),
    ])
    myMatches = (mine as PlayerMatch[] | null) ?? null
    tdMatches = (managed as TdMatch[] | null) ?? null

    const { data: myParticipants } = await supabase
      .from('participants')
      .select('id, tournament_id')
      .eq('user_id', userId)
    const myPartIds = (myParticipants ?? []).map((p) => p.id)
    if (myPartIds.length > 0) {
      const { data: teams } = await supabase
        .from('teams')
        .select(
          'id, tournament_id, captain_participant_id, partner_participant_id, invite_status',
        )
        .eq('invite_status', 'pending')
        .in('partner_participant_id', myPartIds)
      const captainIds = (teams ?? []).map((t) => t.captain_participant_id)
      const tournamentIds = (teams ?? []).map((t) => t.tournament_id)
      const [{ data: captains }, { data: tournaments }] = await Promise.all([
        captainIds.length
          ? supabase
              .from('participants')
              .select('id, display_name')
              .in('id', captainIds)
          : Promise.resolve({ data: [] }),
        tournamentIds.length
          ? supabase.from('tournaments').select('id, name').in('id', tournamentIds)
          : Promise.resolve({ data: [] }),
      ])
      const captainById = new Map(
        (captains ?? []).map((c) => [c.id, c.display_name]),
      )
      const tourneyById = new Map((tournaments ?? []).map((t) => [t.id, t.name]))
      pendingInvites = (teams ?? []).map((t) => ({
        team_id: t.id,
        tournament_id: t.tournament_id,
        tournament_name: tourneyById.get(t.tournament_id) ?? 'Tournament',
        captain_name: captainById.get(t.captain_participant_id) ?? 'A player',
      }))
    }
  }

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, start_date, end_date, status')
    .order('start_date', { ascending: false })

  return (
    <div className="space-y-8">
      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-xl font-medium mb-3">Doubles invitations</h2>
          <ul className="space-y-2">
            {pendingInvites.map((inv) => (
              <li
                key={inv.team_id}
                className="rounded border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <p>
                    <strong>{inv.captain_name}</strong> invited you to play
                    doubles in{' '}
                    <Link
                      href={`/tournaments/${inv.tournament_id}`}
                      className="underline"
                    >
                      {inv.tournament_name}
                    </Link>
                    .
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <form action={acceptInvite}>
                    <input
                      type="hidden"
                      name="tournament_id"
                      value={inv.tournament_id}
                    />
                    <input type="hidden" name="team_id" value={inv.team_id} />
                    <button
                      type="submit"
                      className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
                    >
                      Accept
                    </button>
                  </form>
                  <form action={declineInvite}>
                    <input
                      type="hidden"
                      name="tournament_id"
                      value={inv.tournament_id}
                    />
                    <input type="hidden" name="team_id" value={inv.team_id} />
                    <button
                      type="submit"
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-white"
                    >
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {userId && (
        <section>
          <h2 className="text-xl font-medium mb-3">Your matches</h2>
          {!myMatches || myMatches.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
              No matches awaiting a score from you right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {myMatches.map((m) => (
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
                        vs {m.opponent_label}
                        <span
                          className={`ml-2 text-xs rounded px-1.5 py-0.5 ${PLAYER_STATUS_BADGE[m.match_status] ?? 'bg-zinc-100 text-[var(--color-muted)]'}`}
                        >
                          {PLAYER_STATUS_LABEL[m.match_status] ?? m.match_status}
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
                      Enter result →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tdMatches && (
        <section>
          <h2 className="text-xl font-medium mb-3">
            Matches needing attention{' '}
            <span className="text-sm text-[var(--color-muted)] font-normal">
              (TD view · {tdMatches.length})
            </span>
          </h2>
          {tdMatches.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
              No open matches in your tournaments.
            </div>
          ) : (
            <ul className="space-y-2">
              {tdMatches.map((m) => (
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
                          className={`ml-2 text-xs rounded px-1.5 py-0.5 ${TD_STATUS_BADGE[m.match_status] ?? 'bg-zinc-100 text-[var(--color-muted)]'}`}
                        >
                          {TD_STATUS_LABEL[m.match_status] ?? m.match_status}
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
      )}

      <section>
        <div>
          <h1 className="text-3xl font-semibold">Tournaments</h1>
          <p className="text-[var(--color-muted)] mt-1">
            Sign up, view draws, and report results.
          </p>
        </div>
        <div className="mt-4">
          {!tournaments || tournaments.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--color-border)] p-8 text-center text-[var(--color-muted)]">
              No tournaments yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {tournaments.map((t) => (
                <li
                  key={t.id}
                  className="rounded border border-[var(--color-border)] bg-white"
                >
                  <Link
                    href={`/tournaments/${t.id}`}
                    className="block p-4 hover:bg-zinc-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-medium">{t.name}</h2>
                        <p className="text-sm text-[var(--color-muted)]">
                          {t.start_date} – {t.end_date}
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                        {t.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
