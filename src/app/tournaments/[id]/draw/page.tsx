import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import { Bracket } from '@/components/Bracket'
import { loadEntriesForTournament } from '@/app/tournaments/[id]/load-entries'
import { byLastName, lastName } from '@/lib/names'
import {
  generateDraw,
  regenerateDraw,
  publishDraw,
  swapEntries,
  replaceParticipant,
  substituteFromDirectory,
  setSeeds,
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
    .select('id, name, draw_status, kind')
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
      <header>
        <Link
          href={`/tournaments/${id}`}
          className="text-sm text-[var(--color-muted)] hover:underline"
        >
          ← Tournament
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Draw · {tournament.name}</h1>
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mt-1">
          Draw status: {tournament.draw_status}
        </p>
      </header>

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
          {ok === 'seeded' && 'Seeds saved.'}
        </p>
      )}

      {entries.length > 0 && (
        <section className="bg-white border border-[var(--color-border)] rounded p-4">
          <h2 className="font-medium">Seeds</h2>
          <p className="text-sm text-[var(--color-muted)] mt-1 mb-3">
            Assign seed numbers (1, 2, 3, …) to rank entries. Lower numbers go
            first; blank entries are placed after the seeded ones.
            {hasDraw && ' Regenerate the draw to apply seed changes to bracket positions.'}
          </p>
          <form action={setSeeds} className="space-y-2">
            <input type="hidden" name="tournament_id" value={id} />
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-1">
                  <input
                    type="number"
                    name={`seed_${e.id}`}
                    defaultValue={e.seed ?? ''}
                    min={1}
                    inputMode="numeric"
                    className="w-16 rounded border border-[var(--color-border)] px-2 py-1 text-sm"
                  />
                  <span className="text-sm truncate">{e.display}</span>
                </li>
              ))}
            </ul>
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
            >
              Save seeds
            </button>
          </form>
        </section>
      )}

      <section className="flex flex-wrap gap-3">
        {!hasDraw && (
          <form action={generateDraw}>
            <input type="hidden" name="tournament_id" value={id} />
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
            >
              Generate draw
            </button>
          </form>
        )}
        {hasDraw && (
          <>
            <form action={regenerateDraw}>
              <input type="hidden" name="tournament_id" value={id} />
              <button
                type="submit"
                className="rounded border border-red-300 text-red-700 px-4 py-2 hover:bg-red-50"
              >
                Regenerate (destructive)
              </button>
            </form>
            {tournament.draw_status === 'seeded' && (
              <form action={publishDraw}>
                <input type="hidden" name="tournament_id" value={id} />
                <button
                  type="submit"
                  className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
                >
                  Publish draw
                </button>
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
            }))}
            entries={entries}
          />
        </section>
      )}

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
            <button
              type="submit"
              className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
            >
              Swap
            </button>
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
                  <button
                    type="submit"
                    className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
                  >
                    Substitute
                  </button>
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
                <button
                  type="submit"
                  className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
                >
                  Replace
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  )
}
