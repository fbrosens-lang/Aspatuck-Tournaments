import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession, isTdOfTournament } from '@/lib/auth'
import {
  reportScore,
  overrideScore,
  tdSimpleScore,
  tdClearMatchResult,
} from './actions'
import { formatSetsScore } from '@/lib/format-sets'
import { withdrawSelf } from '@/app/tournaments/entry-actions'
import { SubmitButton } from '@/components/SubmitButton'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reported: 'Reported (awaiting opponent)',
  confirmed: 'Confirmed',
  disputed: 'Disputed (TD will resolve)',
  overridden: 'Overridden by TD',
}

export default async function MatchPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  const supabase = await createClient()

  const { data: match } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status, reported_by, reported_at, deadline_override, score_summary',
    )
    .eq('id', id)
    .maybeSingle()
  if (!match) notFound()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, match_kind, sets_to_win')
    .eq('id', match.tournament_id)
    .maybeSingle()
  if (!tournament) notFound()

  const { data: roundDeadline } = await supabase
    .from('tournament_round_deadlines')
    .select('deadline')
    .eq('tournament_id', tournament.id)
    .eq('round', match.round)
    .maybeSingle()

  const effectiveDeadline = match.deadline_override ?? roundDeadline?.deadline ?? null

  const entryIds = [match.entry_a_id, match.entry_b_id].filter(
    (x): x is string => !!x,
  )
  const { data: entries } = entryIds.length
    ? await supabase
        .from('entries')
        .select('id, participant_id, team_id')
        .in('id', entryIds)
    : { data: [] }

  const participantIds = new Set<string>()
  const teamIds: string[] = []
  for (const e of entries ?? []) {
    if (e.participant_id) participantIds.add(e.participant_id)
    if (e.team_id) teamIds.push(e.team_id)
  }

  const { data: teams } = teamIds.length
    ? await supabase
        .from('teams')
        .select('id, captain_participant_id, partner_participant_id')
        .in('id', teamIds)
    : { data: [] }
  for (const t of teams ?? []) {
    participantIds.add(t.captain_participant_id)
    if (t.partner_participant_id) participantIds.add(t.partner_participant_id)
  }

  const { data: participants } = participantIds.size
    ? await supabase
        .from('participants')
        .select('id, display_name, user_id')
        .in('id', Array.from(participantIds))
    : { data: [] }

  const partById = new Map((participants ?? []).map((p) => [p.id, p]))
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]))
  const entryById = new Map((entries ?? []).map((e) => [e.id, e]))

  function entryLabel(entryId: string | null): string {
    if (!entryId) return 'TBD'
    const e = entryById.get(entryId)
    if (!e) return 'TBD'
    if (e.participant_id) return partById.get(e.participant_id)?.display_name ?? '?'
    if (e.team_id) {
      const t = teamById.get(e.team_id)
      if (!t) return '?'
      const cap = partById.get(t.captain_participant_id)?.display_name ?? '?'
      const par = t.partner_participant_id
        ? partById.get(t.partner_participant_id)?.display_name ?? '?'
        : '(unassigned)'
      return `${cap} / ${par}`
    }
    return '?'
  }

  const aLabel = entryLabel(match.entry_a_id)
  const bLabel = entryLabel(match.entry_b_id)

  const { data: sets } = await supabase
    .from('match_sets')
    .select('set_number, games_a, games_b, tiebreak_a, tiebreak_b')
    .eq('match_id', id)
    .order('set_number')

  const { userId } = await getSession()
  const td = await isTdOfTournament(tournament.id)

  let amInMatch = false
  let myEntryId: string | null = null
  if (userId) {
    for (const e of entries ?? []) {
      if (e.participant_id) {
        const p = partById.get(e.participant_id)
        if (p?.user_id === userId) {
          amInMatch = true
          myEntryId = e.id
        }
      }
      if (e.team_id) {
        const t = teamById.get(e.team_id)
        if (t) {
          const cap = partById.get(t.captain_participant_id)
          const par = t.partner_participant_id
            ? partById.get(t.partner_participant_id)
            : null
          if (cap?.user_id === userId || par?.user_id === userId) {
            amInMatch = true
            myEntryId = e.id
          }
        }
      }
    }
  }

  const finalized = match.status === 'confirmed' || match.status === 'overridden'
  const canReport = amInMatch && match.entry_a_id && match.entry_b_id && !finalized
  const canOverride = td && match.entry_a_id && match.entry_b_id
  const canWithdraw = amInMatch && !!myEntryId && !finalized

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header>
        <Link
          href={`/tournaments/${tournament.id}`}
          className="text-sm text-[var(--color-muted)] hover:underline"
        >
          ← {tournament.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">
          Round {match.round} · Match
        </h1>
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mt-1">
          {STATUS_LABEL[match.status] ?? match.status}
          {effectiveDeadline && (
            <> · deadline {new Date(effectiveDeadline).toLocaleString()}</>
          )}
        </p>
      </header>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {ok === 'reported' && 'Score saved. The winner has been advanced to the next round.'}
          {ok === 'overridden' && 'Score overridden.'}
          {ok === 'simple_saved' && 'Winner and score saved.'}
          {ok === 'withdrawn' && 'You have withdrawn from this tournament.'}
          {ok === 'cleared' && 'Match result cleared. The match is back to pending.'}
        </p>
      )}

      <section className="rounded border border-[var(--color-border)] bg-white p-4">
        <Side
          label={aLabel}
          winner={match.winner_entry_id === match.entry_a_id}
        />
        <Side
          label={bLabel}
          winner={match.winner_entry_id === match.entry_b_id}
        />
        {sets && sets.length > 0 && (
          <div className="mt-3 text-sm text-[var(--color-muted)]">
            Sets: {formatSetsScore(sets)}
          </div>
        )}
        {match.score_summary && (
          <div className="mt-3 text-sm text-[var(--color-muted)]">
            Score: <span className="text-[var(--color-fg)]">{match.score_summary}</span>
          </div>
        )}
      </section>

      {canWithdraw && myEntryId && (
        <section className="rounded border border-[var(--color-border)] bg-white p-4 space-y-2">
          <h2 className="font-medium">Withdraw from this tournament</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Withdrawing will hand any unplayed match to your opponent as a
            walkover. Already-played matches are unaffected.
          </p>
          <form action={withdrawSelf}>
            <input type="hidden" name="tournament_id" value={tournament.id} />
            <input type="hidden" name="entry_id" value={myEntryId} />
            <SubmitButton
              variant="plain"
              className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
              pendingLabel="Withdrawing…"
            >
              Withdraw
            </SubmitButton>
          </form>
        </section>
      )}

      {(canReport || canOverride) && (
        <section className="rounded border border-[var(--color-border)] bg-white p-4 space-y-3">
          <h2 className="font-medium">
            {canReport ? 'Report score' : 'Override score'}
          </h2>
          <form
            action={canReport && !td ? reportScore : overrideScore}
            className="space-y-3"
          >
            <input type="hidden" name="match_id" value={match.id} />
            <table className="w-full text-sm">
              <thead className="text-[var(--color-muted)] text-xs uppercase">
                <tr>
                  <th className="text-left font-medium pb-1">Set</th>
                  <th className="text-left font-medium pb-1">{aLabel}</th>
                  <th className="text-left font-medium pb-1">{bLabel}</th>
                  <th className="text-left font-medium pb-1">Tie Break score</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((n) => {
                  const existing = sets?.find((s) => s.set_number === n)
                  return (
                    <tr key={n}>
                      <td className="py-1 pr-2 text-[var(--color-muted)]">{n}</td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          name={`set_${n}_a`}
                          min={0}
                          defaultValue={existing?.games_a ?? ''}
                          className="w-16 rounded border border-[var(--color-border)] px-2 py-1"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          name={`set_${n}_b`}
                          min={0}
                          defaultValue={existing?.games_b ?? ''}
                          className="w-16 rounded border border-[var(--color-border)] px-2 py-1"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          name={`set_${n}_tb_score`}
                          inputMode="numeric"
                          placeholder="e.g. 7-3"
                          pattern="\d+\s*[-–]\s*\d+"
                          defaultValue={
                            existing?.tiebreak_a != null && existing?.tiebreak_b != null
                              ? `${existing.tiebreak_a}-${existing.tiebreak_b}`
                              : ''
                          }
                          className="w-28 rounded border border-[var(--color-border)] px-2 py-1"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <label className="block">
              <span className="text-sm">Winner</span>
              <select
                name="winner_entry_id"
                required
                defaultValue={match.winner_entry_id ?? ''}
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              >
                <option value="">— pick —</option>
                {match.entry_a_id && (
                  <option value={match.entry_a_id}>{aLabel}</option>
                )}
                {match.entry_b_id && (
                  <option value={match.entry_b_id}>{bLabel}</option>
                )}
              </select>
            </label>
            <SubmitButton variant="primary" pendingLabel="Submitting…">
              {canReport && !td ? 'Submit score' : 'Override'}
            </SubmitButton>
          </form>
          {td && match.status !== 'pending' && (
            <form action={tdClearMatchResult} className="border-t border-[var(--color-border)] pt-3 space-y-2">
              <input type="hidden" name="match_id" value={match.id} />
              <SubmitButton
                variant="plain"
                className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
                pendingLabel="Clearing…"
              >
                Clear result
              </SubmitButton>
              <p className="text-xs text-[var(--color-muted)]">
                Returns this match to pending and removes the winner from the
                next round. If the next match has already been played, clear
                that one first.
              </p>
            </form>
          )}
        </section>
      )}

      {/* TD-only: a free-text "simple score" path for matches whose
          result doesn't fit the sets table — golf "4&3", a stroke-play
          score like "75-72", a Calcutta single-set, etc. Skips set
          validation, marks the match overridden, advances the winner
          like the regular override. The sets form above is still
          available; the TD picks whichever is appropriate. */}
      {td && match.entry_a_id && match.entry_b_id && (
        <section className="rounded border border-[var(--color-border)] bg-white p-4 space-y-3">
          <h2 className="font-medium">Simple score (TD)</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Use this when the match format doesn&apos;t fit the sets table
            above (golf match-play, stroke play, a single-set Calcutta,
            etc.). Pick the winner and write the score however you&apos;d
            describe it. Submitting marks the match overridden and
            advances the winner.
          </p>
          <form action={tdSimpleScore} className="space-y-3">
            <input type="hidden" name="match_id" value={match.id} />
            <label className="block">
              <span className="text-sm">Score</span>
              <input
                type="text"
                name="summary"
                maxLength={200}
                defaultValue={match.score_summary ?? ''}
                placeholder="e.g. 4&3, 75-72, 6-2"
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm">Winner</span>
              <select
                name="winner_entry_id"
                required
                defaultValue={match.winner_entry_id ?? ''}
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              >
                <option value="">— pick —</option>
                {match.entry_a_id && (
                  <option value={match.entry_a_id}>{aLabel}</option>
                )}
                {match.entry_b_id && (
                  <option value={match.entry_b_id}>{bLabel}</option>
                )}
              </select>
            </label>
            <SubmitButton
              variant="plain"
              className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
              pendingLabel="Saving…"
            >
              Save simple score
            </SubmitButton>
          </form>
        </section>
      )}
    </div>
  )
}

function Side({ label, winner }: { label: string; winner: boolean }) {
  return (
    <div className={`py-1 ${winner ? 'font-semibold' : ''}`}>
      <span className="inline-block w-3 mr-2 text-[var(--color-accent)]">
        {winner ? '●' : ''}
      </span>
      {label}
    </div>
  )
}
