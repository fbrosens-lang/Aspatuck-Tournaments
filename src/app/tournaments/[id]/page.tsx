import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession, isTdOfTournament } from '@/lib/auth'
import { Bracket } from '@/components/Bracket'
import { RegisterPanel } from '@/components/RegisterButton'
import {
  loadEntriesForTournament,
  loadMyEntryState,
} from '@/app/tournaments/[id]/load-entries'
import { withdrawSelf } from '@/app/tournaments/entry-actions'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

const OK_MESSAGES: Record<string, string> = {
  registered: 'You’re registered.',
  invited: 'Invite sent. Your partner will see it on their home page.',
  withdrawn: 'Withdrawn.',
  accepted: 'Invite accepted.',
  declined: 'Invite declined.',
}

export default async function TournamentPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  const supabase = await createClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select(
      'id, name, location, start_date, end_date, registration_deadline, status, kind, bracket_format, match_kind, draw_status, requires_dob, min_age, max_age',
    )
    .eq('id', id)
    .maybeSingle()
  if (!tournament) notFound()

  const entries = await loadEntriesForTournament(id)

  const { data: matches } = await supabase
    .from('matches')
    .select('id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status')
    .eq('tournament_id', id)
    .order('round')
    .order('slot')

  const td = await isTdOfTournament(id)
  const { userId } = await getSession()
  const myState = userId
    ? await loadMyEntryState(id, userId)
    : { kind: 'none' as const }

  const hasDraw = (matches?.length ?? 0) > 0
  const canRegister =
    !!userId &&
    tournament.status === 'open' &&
    tournament.draw_status === 'open'
  const myEntryId =
    myState.kind === 'singles' || myState.kind === 'team' ? myState.entryId : null

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{tournament.name}</h1>
          <p className="text-[var(--color-muted)] mt-1">
            {tournament.location ?? 'Location TBD'} · {tournament.start_date} – {tournament.end_date}
          </p>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            {tournament.kind} · {tournament.bracket_format} · {tournament.match_kind}
            {tournament.requires_dob && ' · DOB required'}
            {tournament.min_age != null && ` · min ${tournament.min_age}`}
            {tournament.max_age != null && ` · max ${tournament.max_age}`}
          </p>
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mt-1">
            Status: {tournament.status} · Draw: {tournament.draw_status}
            {tournament.registration_deadline && (
              <> · Registration closes {new Date(tournament.registration_deadline).toLocaleString()}</>
            )}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {td && (
            <>
              <Link
                href={`/tournaments/${id}/manage`}
                className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
              >
                Manage
              </Link>
              <Link
                href={`/tournaments/${id}/participants`}
                className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
              >
                Participants
              </Link>
              <Link
                href={`/tournaments/${id}/entries`}
                className="rounded border border-[var(--color-border)] px-3 py-1.5 hover:bg-zinc-50"
              >
                Entries
              </Link>
              <Link
                href={`/tournaments/${id}/draw`}
                className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 hover:opacity-90"
              >
                Draw
              </Link>
            </>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {OK_MESSAGES[ok] ?? 'Saved.'}
        </p>
      )}

      {userId && (
        <section>
          <RegisterPanel
            tournamentId={id}
            kind={tournament.kind as 'singles' | 'doubles'}
            canRegister={canRegister}
            drawIsSet={hasDraw}
            me={myState}
          />
        </section>
      )}

      <section>
        <h2 className="text-xl font-medium mb-3">
          Entries{' '}
          <span className="text-sm text-[var(--color-muted)] font-normal">
            ({entries.length})
          </span>
        </h2>
        {entries.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--color-muted)]">
            No entries yet.
          </div>
        ) : (
          <ul className="rounded border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
            {entries.map((e, idx) => {
              const isMine = !!myEntryId && e.id === myEntryId
              return (
                <li
                  key={e.id}
                  className="px-4 py-2 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-[var(--color-muted)] w-6">
                      {e.seed ?? idx + 1}
                    </span>
                    <span className="truncate">{e.display}</span>
                    {isMine && (
                      <span className="text-xs rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                        you
                      </span>
                    )}
                    {e.added_by_td_id && (
                      <span className="text-xs rounded bg-zinc-100 px-1.5 py-0.5 text-[var(--color-muted)]">
                        added by TD
                      </span>
                    )}
                    {e.status !== 'confirmed' && (
                      <span className="text-xs rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                        {e.status}
                      </span>
                    )}
                  </div>
                  {isMine && (
                    <form action={withdrawSelf}>
                      <input type="hidden" name="tournament_id" value={id} />
                      <input type="hidden" name="entry_id" value={e.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-700 hover:underline shrink-0"
                      >
                        Withdraw
                      </button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {hasDraw && (
        <section>
          <h2 className="text-xl font-medium mb-3">Draw</h2>
          <Bracket
            matches={matches!.map((m) => ({
              ...m,
              status: m.status as 'pending' | 'reported' | 'confirmed' | 'disputed' | 'overridden',
              bracket: m.bracket as 'main' | 'consolation',
            }))}
            entries={entries}
          />
        </section>
      )}
    </div>
  )
}
