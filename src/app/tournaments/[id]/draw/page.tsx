import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import { Bracket } from '@/components/Bracket'
import { SubmitButton } from '@/components/SubmitButton'
import { loadEntriesForTournament } from '@/app/tournaments/[id]/load-entries'
import { byLastName, lastName } from '@/lib/names'
import {
  fillByeSlot,
  fillByeSlotTeam,
  generateDraw,
  regenerateDraw,
  publishDraw,
  swapEntries,
  replaceParticipant,
  substituteFromDirectory,
} from './actions'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

export default async function DrawPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  if (!(await isTdOfTournament(id))) {
    redirect(`/tournaments/${id}`)
  }

  const supabase = await createClient()
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, draw_status, kind, solo_only')
    .eq('id', id)
    .maybeSingle()
  if (!tournament) notFound()

  const entries = await loadEntriesForTournament(id)

  const { data: matches } = await supabase
    .from('matches')
    .select('id, bracket, round, slot, entry_a_id, entry_b_id, winner_entry_id, status, score_summary')
    .eq('tournament_id', id)
    .order('round')
    .order('slot')

  const matchIds = (matches ?? []).map((m) => m.id)
  type SetRow = {
    match_id: string
    set_number: number
    games_a: number
    games_b: number
    tiebreak_a: number | null
    tiebreak_b: number | null
  }
  const { data: setRows } = matchIds.length
    ? await supabase
        .from('match_sets')
        .select('match_id, set_number, games_a, games_b, tiebreak_a, tiebreak_b')
        .in('match_id', matchIds)
        .order('set_number')
    : { data: [] as SetRow[] }
  const setsByMatch = new Map<string, SetRow[]>()
  for (const s of (setRows ?? []) as SetRow[]) {
    const arr = setsByMatch.get(s.match_id) ?? []
    arr.push(s)
    setsByMatch.set(s.match_id, arr)
  }

  const { data: roundDeadlineRows } = await supabase
    .from('tournament_round_deadlines')
    .select('round, deadline')
    .eq('tournament_id', id)
  const deadlineByRound = new Map<number, string>(
    (roundDeadlineRows ?? []).map((r) => [r.round as number, r.deadline as string]),
  )

  const { data: rawParticipants } = await supabase
    .from('participants')
    .select('id, display_name, kind')
    .eq('tournament_id', id)
  const participantsRaw = rawParticipants
    ? [...rawParticipants].sort((a, b) =>
        lastName(a.display_name).localeCompare(lastName(b.display_name)) ||
        a.display_name.localeCompare(b.display_name),
      )
    : null

  const { data: rawClubMembers } = await supabase
    .from('club_members')
    .select('id, full_name, email, user_id')
  const clubMembers = rawClubMembers ? [...rawClubMembers].sort(byLastName) : null

  const hasDraw = (matches?.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium">Draw</h2>
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mt-1">
          Draw status: {tournament.draw_status}
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {ok === 'generated' && 'Draw generated.'}
          {ok === 'regenerated' && 'Draw regenerated.'}
          {ok === 'published' && 'Draw published.'}
          {ok === 'swapped' && 'Entries swapped.'}
          {ok === 'replaced' && 'Participant replaced.'}
          {ok === 'substituted' && 'Substitute placed.'}
          {ok === 'bye_filled' && 'Player added to the bye slot. The bye winner now has a first-round match.'}
          {ok === 'seeded' && 'Seeds saved.'}
        </p>
      )}

      {entries.length > 0 && !hasDraw && (
        <section className="rounded border border-[var(--color-border)] bg-white p-4">
          <p className="text-sm">
            Need to seed entries before generating the bracket? Set seeds on
            the{' '}
            <Link
              href={`/tournaments/${id}/entries`}
              className="underline text-[var(--color-accent)]"
            >
              Roster page
            </Link>
            , then come back here to generate the draw.
          </p>
        </section>
      )}

      <section className="flex flex-wrap gap-3">
        {!hasDraw && (
          <form action={generateDraw}>
            <input type="hidden" name="tournament_id" value={id} />
            <SubmitButton variant="primary" pendingLabel="Generating…">
              Generate draw
            </SubmitButton>
          </form>
        )}
        {hasDraw && (
          <>
            <form action={regenerateDraw}>
              <input type="hidden" name="tournament_id" value={id} />
              <SubmitButton
                variant="plain"
                className="rounded border border-red-300 text-red-700 px-4 py-2 hover:bg-red-50"
                pendingLabel="Regenerating…"
              >
                Regenerate (destructive)
              </SubmitButton>
            </form>
            {tournament.draw_status === 'seeded' && (
              <form action={publishDraw}>
                <input type="hidden" name="tournament_id" value={id} />
                <SubmitButton variant="primary" pendingLabel="Publishing…">
                  Publish draw
                </SubmitButton>
              </form>
            )}
          </>
        )}
      </section>

      {hasDraw && (
        <section>
          <Bracket
            matches={matches!.map((m) => ({
              ...m,
              status: m.status as 'pending' | 'reported' | 'confirmed' | 'disputed' | 'overridden',
              bracket: m.bracket as 'main' | 'consolation',
              sets: setsByMatch.get(m.id),
            }))}
            entries={
              tournament.solo_only
                ? entries
                : entries.map((e) => ({ ...e, handicap: null }))
            }
            deadlineByRound={deadlineByRound}
          />
        </section>
      )}

      {(() => {
        // First-round bye matches: round=1, main bracket, exactly one
        // side populated. Built once here so the JSX below stays clean
        // and we don't recompute on every form render. The bye winner's
        // display name comes from the entries list we already loaded.
        const byMain = (matches ?? []).filter((m) => m.bracket === 'main')
        const entryById = new Map(entries.map((e) => [e.id, e]))
        const byes = byMain
          .filter(
            (m) =>
              m.round === 1 &&
              ((m.entry_a_id && !m.entry_b_id) ||
                (!m.entry_a_id && m.entry_b_id)),
          )
          .map((m) => {
            const winnerId = m.entry_a_id ?? m.entry_b_id
            return {
              matchId: m.id,
              slot: m.slot,
              byeWinner: winnerId ? entryById.get(winnerId)?.display ?? '—' : '—',
            }
          })
        if (byes.length === 0) return null
        const isDoubles = tournament.kind === 'doubles'
        return (
          <section className="bg-white border border-[var(--color-border)] rounded p-4 space-y-3">
            <div>
              <h2 className="font-medium">
                Add {isDoubles ? 'team' : 'player'} to a bye slot
              </h2>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                Drops a brand-new {isDoubles ? 'team' : 'player'} into an
                existing bye, turning it into a real first-round match. The{' '}
                {isDoubles ? 'team' : 'player'} that was getting the free pass
                now has to play to advance. Scores already reported elsewhere
                are untouched.
                {isDoubles && (
                  <>
                    {' '}
                    If either partner is already on the roster, withdraw that
                    entry on the Roster page first — adding the team here
                    creates a fresh entry.
                  </>
                )}
              </p>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {byes.map((b) =>
                isDoubles ? (
                  <li key={b.matchId} className="py-3">
                    <form
                      action={fillByeSlotTeam}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_2fr_auto] gap-3 items-end"
                    >
                      <input type="hidden" name="tournament_id" value={id} />
                      <input type="hidden" name="match_id" value={b.matchId} />
                      <div className="text-sm">
                        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                          Bye slot {b.slot + 1}
                        </div>
                        <div className="font-medium">{b.byeWinner}</div>
                      </div>
                      <label className="block">
                        <span className="text-sm">Captain</span>
                        <select
                          name="captain_club_member_id"
                          required
                          className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                        >
                          <option value="">— pick from directory —</option>
                          {clubMembers?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name} · {m.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-sm">Partner</span>
                        <select
                          name="partner_club_member_id"
                          required
                          className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                        >
                          <option value="">— pick from directory —</option>
                          {clubMembers?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name} · {m.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton
                        variant="plain"
                        className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 justify-self-start sm:justify-self-auto"
                        pendingLabel="Filling…"
                      >
                        Fill bye
                      </SubmitButton>
                    </form>
                  </li>
                ) : (
                  <li key={b.matchId} className="py-3">
                    <form
                      action={fillByeSlot}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 items-end"
                    >
                      <input type="hidden" name="tournament_id" value={id} />
                      <input type="hidden" name="match_id" value={b.matchId} />
                      <div className="text-sm">
                        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                          Bye slot {b.slot + 1}
                        </div>
                        <div className="font-medium">{b.byeWinner}</div>
                      </div>
                      <label className="block">
                        <span className="text-sm">Add player</span>
                        <select
                          name="club_member_id"
                          required
                          className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                        >
                          <option value="">— pick from directory —</option>
                          {clubMembers?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.full_name} · {m.email}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton
                        variant="plain"
                        className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 justify-self-start sm:justify-self-auto"
                        pendingLabel="Filling…"
                      >
                        Fill bye
                      </SubmitButton>
                    </form>
                  </li>
                ),
              )}
            </ul>
          </section>
        )
      })()}

      {hasDraw && (
        <section className="bg-white border border-[var(--color-border)] rounded p-4 space-y-3">
          <h2 className="font-medium">Edit the draw</h2>
          <form action={swapEntries} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <input type="hidden" name="tournament_id" value={id} />
            <label className="block">
              <span className="text-sm">Entry A</span>
              <select
                name="entry_a"
                required
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              >
                <option value="">— pick —</option>
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.seed ?? ''} {e.display}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Entry B</span>
              <select
                name="entry_b"
                required
                className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
              >
                <option value="">— pick —</option>
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.seed ?? ''} {e.display}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton
              variant="plain"
              className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
              pendingLabel="Swapping…"
            >
              Swap
            </SubmitButton>
          </form>

          {tournament.kind === 'singles' && (
            <>
              <form
                action={substituteFromDirectory}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pt-3 border-t border-[var(--color-border)]"
              >
                <input type="hidden" name="tournament_id" value={id} />
                <label className="block sm:col-span-2">
                  <span className="text-sm">Replace bracket position</span>
                  <select
                    name="entry_id"
                    required
                    className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                  >
                    <option value="">— pick existing entry —</option>
                    {entries
                      .filter((e) => !!e.participant_id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.seed ? `[${e.seed}] ` : ''}
                          {e.display}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm">With club member</span>
                  <select
                    name="club_member_id"
                    required
                    className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                  >
                    <option value="">— pick from directory —</option>
                    {clubMembers?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} · {m.email}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="bypass" /> Bypass requirements
                  </label>
                  <SubmitButton variant="primary" pendingLabel="Substituting…">
                    Substitute
                  </SubmitButton>
                </div>
                <p className="sm:col-span-4 text-xs text-[var(--color-muted)]">
                  Use this for late entries or no-shows: pick a bracket position
                  and replace whoever is currently in it with someone from the
                  directory. The previous player is removed from this tournament.
                </p>
              </form>

              <form
                action={replaceParticipant}
                className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-3 border-t border-[var(--color-border)]"
              >
                <input type="hidden" name="tournament_id" value={id} />
                <label className="block">
                  <span className="text-sm">Entry</span>
                  <select
                    name="entry_id"
                    required
                    className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                  >
                    <option value="">— pick —</option>
                    {entries
                      .filter((e) => !!e.participant_id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.display}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm">With existing participant</span>
                  <select
                    name="new_participant_id"
                    required
                    className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                  >
                    <option value="">— pick —</option>
                    {participantsRaw?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name} ({p.kind})
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton
                  variant="plain"
                  className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
                  pendingLabel="Replacing…"
                >
                  Replace
                </SubmitButton>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  )
}
