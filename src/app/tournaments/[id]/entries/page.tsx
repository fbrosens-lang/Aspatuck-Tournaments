import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import {
  saveSeeds,
  tdAcceptTeamInvite,
  tdAddAndEnterGuest,
  tdClearSeeds,
  tdDeclineTeamInvite,
  tdEnterMember,
  tdEnterGuest,
  tdEnterClubMember,
  tdEnterTeamFromClubMembers,
  tdPairSoloEntries,
  tdWithdrawEntry,
  tdRegenerateDraw,
  tdClearDraw,
  tdGenerateDraw,
} from './actions'
import { loadEntriesForTournament } from '@/app/tournaments/[id]/load-entries'
import { Combobox, type ComboboxItem } from '@/components/Combobox'
import { SeedVisibilityToggle } from '@/components/SeedVisibilityToggle'
import { byLastName, lastName } from '@/lib/names'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

export default async function ManageEntriesPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams
  if (!(await isTdOfTournament(id))) {
    redirect(`/tournaments/${id}`)
  }

  const supabase = await createClient()
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, kind, draw_status, show_seeds_publicly')
    .eq('id', id)
    .maybeSingle()
  if (!tournament) notFound()

  const entries = await loadEntriesForTournament(id)

  const { count: matchCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', id)
  const drawExists = (matchCount ?? 0) > 0
  const confirmedCount = entries.filter((e) => e.status === 'confirmed').length
  // Unpaired entries can't be drawn into the bracket — they need a
  // partner first. We surface them in the "no draw yet" copy below so
  // the TD knows why the Generate button stays disabled.
  const unpairedCount = entries.filter((e) => e.status === 'unpaired').length

  const { data: rawMembers } = await supabase
    .from('profiles')
    .select('id, full_name, contact_email')
  const members = rawMembers ? [...rawMembers].sort(byLastName) : null

  const { data: rawClubMembers } = await supabase
    .from('club_members')
    .select('id, full_name, email, user_id')
  const clubMembers = rawClubMembers ? [...rawClubMembers].sort(byLastName) : null

  const { data: rawGuests } = await supabase
    .from('participants')
    .select('id, display_name, email')
    .eq('tournament_id', id)
    .eq('kind', 'guest')
  const guests = rawGuests
    ? [...rawGuests].sort((a, b) =>
        lastName(a.display_name).localeCompare(lastName(b.display_name)) ||
        a.display_name.localeCompare(b.display_name),
      )
    : null

  // ----- Combobox item lists (typeahead options) -----
  const clubMemberItems: ComboboxItem[] = (clubMembers ?? []).map((m) => ({
    value: m.id,
    label: m.full_name,
    sublabel: `${m.email}${m.user_id ? ' · has account' : ''}`,
  }))
  const memberItems: ComboboxItem[] = (members ?? []).map((m) => ({
    value: m.id,
    label: m.full_name,
    sublabel: m.contact_email,
  }))
  const guestItems: ComboboxItem[] = (guests ?? []).map((g) => ({
    value: g.id,
    label: g.display_name,
    sublabel: g.email ?? undefined,
  }))

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">Roster</h2>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {(() => {
            if (ok === 'generated') return 'Draw generated with the current roster.'
            if (ok === 'regenerated') return 'Draw regenerated with the current roster.'
            if (ok === 'cleared')
              return 'Draw cleared. Sign-ups are open again — players can register and you can regenerate when you’re ready.'
            if (ok === 'team_accepted')
              return 'Team invite accepted on behalf of the partner. The entry is now confirmed.'
            if (ok === 'team_declined')
              return 'Team invite declined on behalf of the partner. The entry has been withdrawn.'
            if (ok === 'paired')
              return 'Players paired. The two solo entries are now one confirmed team.'
            if (ok === 'seeded') return 'Seeds saved.'
            if (ok === 'seeds_cleared')
              return 'All seeds cleared. Add fresh seed numbers and regenerate the draw when ready.'
            if (ok === 'seeds_shown')
              return 'Seed numbers are now visible to players.'
            if (ok === 'seeds_hidden')
              return 'Seed numbers are now hidden from players.'
            if (ok.startsWith('added:')) {
              const name = decodeURIComponent(ok.slice('added:'.length))
              return (
                <>
                  Added <strong>{name}</strong> to the roster. Pick another to
                  add more.
                </>
              )
            }
            return 'Saved.'
          })()}
        </p>
      )}

      <section
        className={`rounded border p-4 ${
          drawExists
            ? 'border-amber-300 bg-amber-50'
            : 'border-[var(--color-border)] bg-white'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">
              {drawExists ? 'Draw is set' : 'No draw yet'}
            </h2>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              {drawExists ? (
                <>
                  The bracket was built from a previous roster. Add or remove
                  entries first, then regenerate to rebuild the draw with
                  whoever&apos;s currently confirmed ({confirmedCount}{' '}
                  {confirmedCount === 1 ? 'player' : 'players'}).
                </>
              ) : (
                <>
                  Once you have at least 2 confirmed entries, generate the draw
                  to build the bracket.
                  {unpairedCount > 0 && (
                    <>
                      {' '}
                      {unpairedCount}{' '}
                      {unpairedCount === 1
                        ? 'player is still unpaired'
                        : 'players are still unpaired'}{' '}
                      — pair them above before generating.
                    </>
                  )}
                </>
              )}
            </p>
            <p className="text-xs text-red-700 mt-2">
              {drawExists &&
                'Regenerating or undoing the draw destroys the current bracket and any reported scores. Result history is preserved in the audit log. Undo also reopens sign-ups so players can register again.'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            {drawExists ? (
              <>
                <form action={tdClearDraw}>
                  <input type="hidden" name="tournament_id" value={id} />
                  <button
                    type="submit"
                    className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50"
                    title="Delete the bracket and reopen sign-ups. Players can register again."
                  >
                    Undo draw
                  </button>
                </form>
                <form action={tdRegenerateDraw}>
                  <input type="hidden" name="tournament_id" value={id} />
                  <button
                    type="submit"
                    className="rounded border border-red-300 text-red-700 px-4 py-2 hover:bg-red-100"
                  >
                    Regenerate draw
                  </button>
                </form>
              </>
            ) : (
              <form action={tdGenerateDraw}>
                <input type="hidden" name="tournament_id" value={id} />
                <button
                  type="submit"
                  className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
                  disabled={confirmedCount < 2}
                >
                  Generate draw
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {tournament.kind === 'singles' && (
        <>
          <section className="bg-white border border-[var(--color-border)] rounded p-4">
            <h2 className="font-medium mb-3">Enter from the club directory</h2>
            <p className="text-sm text-[var(--color-muted)] mb-3">
              Pick anyone from the Aspatuck directory. They&apos;ll be entered
              as a member whether or not they have an account. To enter
              someone who isn&apos;t in the directory, use{' '}
              <strong>Add a new guest</strong> below.
            </p>
            <form
              action={tdEnterClubMember}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <input type="hidden" name="tournament_id" value={id} />
              <label className="block sm:col-span-4">
                <span className="text-sm">Club member</span>
                <Combobox
                  name="club_member_id"
                  items={clubMemberItems}
                  required
                  placeholder="Type a name…"
                  ariaLabel="Club member"
                  submitOnPick
                />
              </label>
              <button
                type="submit"
                className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-4 justify-self-start"
              >
                Enter from directory
              </button>
            </form>
          </section>

          <section className="bg-white border border-[var(--color-border)] rounded p-4">
            <h2 className="font-medium mb-3">Enter a registered user</h2>
            <p className="text-sm text-[var(--color-muted)] mb-3">
              Pick from anyone who has signed up for an account (regardless of
              whether they&apos;re in the club directory).
            </p>
            <form
              action={tdEnterMember}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <input type="hidden" name="tournament_id" value={id} />
              <label className="block sm:col-span-4">
                <span className="text-sm">Account</span>
                <Combobox
                  name="user_id"
                  items={memberItems}
                  required
                  placeholder="Type a name…"
                  ariaLabel="Registered user"
                  submitOnPick
                />
              </label>
              <button
                type="submit"
                className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50 sm:col-span-4 justify-self-start"
              >
                Enter account user
              </button>
            </form>
          </section>

          <section className="bg-white border border-[var(--color-border)] rounded p-4">
            <h2 className="font-medium mb-3">Add a new guest</h2>
            <p className="text-sm text-[var(--color-muted)] mb-3">
              For non-account players who aren&apos;t in the club directory.
              They&apos;re added and entered into the roster in one step.
            </p>
            <form
              action={tdAddAndEnterGuest}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
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
                  type="text"
                  name="dob"
                  placeholder="MM/DD/YYYY"
                  inputMode="numeric"
                  autoComplete="bday"
                  pattern="\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}"
                  title="Type the date as MM/DD/YYYY (e.g. 03/14/1975)"
                  className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                />
              </label>
              <button
                type="submit"
                className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-4 justify-self-start"
              >
                Add and enter guest
              </button>
            </form>
          </section>

          {guests && guests.length > 0 && (
            <section className="bg-white border border-[var(--color-border)] rounded p-4">
              <h2 className="font-medium mb-3">Re-enter an existing guest</h2>
              <p className="text-sm text-[var(--color-muted)] mb-3">
                Pick a guest who was previously added to this tournament — handy
                for re-entering someone after they were withdrawn.
              </p>
              <form action={tdEnterGuest} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <input type="hidden" name="tournament_id" value={id} />
                <label className="block sm:col-span-4">
                  <span className="text-sm">Guest participant</span>
                  <Combobox
                    name="participant_id"
                    items={guestItems}
                    required
                    placeholder="Type a name…"
                    ariaLabel="Guest participant"
                    submitOnPick
                  />
                </label>
                <button
                  type="submit"
                  className="rounded border border-[var(--color-border)] px-4 py-2 hover:bg-zinc-50 sm:col-span-4 justify-self-start"
                >
                  Enter guest
                </button>
              </form>
            </section>
          )}
        </>
      )}

      {/* Unpaired players — solo sign-ups in a doubles tournament that
          need a partner before the draw is generated. We only show
          the section for doubles tournaments with at least one
          unpaired entry. The Combobox for each row offers every OTHER
          unpaired entry (so the TD can't pick the same player twice). */}
      {tournament.kind === 'doubles' &&
        (() => {
          const unpaired = entries.filter((e) => e.status === 'unpaired')
          if (unpaired.length === 0) return null
          return (
            <section className="bg-white border border-amber-300 bg-amber-50 rounded p-4">
              <h2 className="font-medium">
                Unpaired players{' '}
                <span className="text-sm text-[var(--color-muted)] font-normal">
                  ({unpaired.length})
                </span>
              </h2>
              <p className="text-sm text-[var(--color-muted)] mt-1 mb-3">
                These players signed up solo. Pair two of them into a team to
                make a confirmed entry. The draw can&apos;t be generated while
                anyone is still unpaired.
                {unpaired.length === 1 && (
                  <>
                    {' '}
                    Need one more solo sign-up before pairing is possible — or
                    enter a team directly above.
                  </>
                )}
              </p>
              <ul className="space-y-2">
                {unpaired.map((u) => {
                  const otherUnpaired: ComboboxItem[] = unpaired
                    .filter((o) => o.id !== u.id)
                    .map((o) => ({ value: o.id, label: o.display }))
                  return (
                    <li
                      key={u.id}
                      className="rounded border border-[var(--color-border)] bg-white p-3"
                    >
                      <form
                        action={tdPairSoloEntries}
                        className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 items-end"
                      >
                        <input type="hidden" name="tournament_id" value={id} />
                        <input type="hidden" name="entry_a_id" value={u.id} />
                        <div className="text-sm">
                          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                            Solo
                          </div>
                          <div className="font-medium">{u.display}</div>
                        </div>
                        <label className="block">
                          <span className="text-sm">Pair with</span>
                          <Combobox
                            name="entry_b_id"
                            items={otherUnpaired}
                            required
                            placeholder={
                              otherUnpaired.length === 0
                                ? 'No other unpaired players'
                                : 'Type a name…'
                            }
                            ariaLabel="Partner to pair with"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={otherUnpaired.length === 0}
                          className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed justify-self-start sm:justify-self-auto"
                        >
                          Pair
                        </button>
                      </form>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })()}

      {tournament.kind === 'doubles' && (
        <section className="bg-white border border-[var(--color-border)] rounded p-4">
          <h2 className="font-medium mb-3">Enter a doubles team</h2>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            Pick both partners from the club directory. They&apos;re entered as
            members whether or not they have an account.
          </p>
          <form
            action={tdEnterTeamFromClubMembers}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end"
          >
            <input type="hidden" name="tournament_id" value={id} />
            <label className="block">
              <span className="text-sm">Captain</span>
              <Combobox
                name="captain_club_member_id"
                items={clubMemberItems}
                required
                placeholder="Type a name…"
                ariaLabel="Captain"
              />
            </label>
            <label className="block">
              <span className="text-sm">Partner</span>
              <Combobox
                name="partner_club_member_id"
                items={clubMemberItems}
                required
                placeholder="Type a name…"
                ariaLabel="Partner"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-2 justify-self-start"
            >
              Enter team
            </button>
          </form>
        </section>
      )}

      {entries.length > 0 && (
        <section className="bg-white border border-[var(--color-border)] rounded p-4">
          <h2 className="font-medium">Seed entries</h2>
          <p className="text-sm text-[var(--color-muted)] mt-1 mb-3">
            Assign seed numbers (1, 2, 3, …) to rank entries before generating
            the draw. Lower numbers are placed first in the bracket; leave
            blank for entries you don&apos;t want to seed.
            {drawExists &&
              ' Regenerate the draw above to apply seed changes to bracket positions.'}
          </p>
          <div className="mb-4">
            <SeedVisibilityToggle
              tournamentId={id}
              showSeedsPublicly={tournament.show_seeds_publicly}
              returnTo="entries"
            />
          </div>
          <form action={saveSeeds} className="space-y-3">
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
                    aria-label={`Seed for ${e.display}`}
                    className="w-16 rounded border border-[var(--color-border)] px-2 py-1 text-sm"
                  />
                  <span className="text-sm truncate">{e.display}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
              >
                Save seeds
              </button>
              {/* formAction overrides the parent form's saveSeeds action so
                  we don't need a second form. tdClearSeeds only reads
                  tournament_id; the seed_* inputs are ignored. */}
              <button
                type="submit"
                formAction={tdClearSeeds}
                className="rounded border border-red-300 text-red-700 px-4 py-2 hover:bg-red-100"
              >
                Clear all seeds
              </button>
            </div>
          </form>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-1">
          Current entries{' '}
          <span className="text-sm text-[var(--color-muted)] font-normal">({entries.length})</span>
        </h2>
        {entries.length > 0 && (() => {
          const seededCount = entries.filter((e) => e.seed != null).length
          const unseededCount = entries.length - seededCount
          return (
            <p className="text-xs text-[var(--color-muted)] mb-3">
              {seededCount} seeded · {unseededCount} unseeded (will be placed
              randomly in the draw).
            </p>
          )
        })()}
        {entries.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--color-muted)]">
            No entries yet.
          </div>
        ) : (
          <ul className="rounded border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
            {entries.map((e) => {
              // A pending team invite: the captain signed up with a partner,
              // partner hasn't accepted yet. TD can confirm on behalf of the
              // partner (e.g., captain told the TD their partner agreed).
              const pendingTeamInvite =
                e.status === 'pending' && e.team_id !== null
              return (
                <li
                  key={e.id}
                  className="px-4 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Show the seed only for explicitly seeded entries. A
                        dash for unseeded keeps the column aligned without
                        implying a seed — those entries get random bracket
                        positions when the draw is generated. */}
                    <span className="text-xs text-[var(--color-muted)] w-6 text-right">{e.seed ?? '—'}</span>
                    <span className="truncate">{e.display}</span>
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
                  {/* Tap zones stay 44px high (min-h-11) so the small text
                      links work on a phone without ballooning the visual
                      chip — the padding extends the touch area. */}
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap pl-9 sm:pl-0">
                    {pendingTeamInvite && (
                      <>
                        <form action={tdAcceptTeamInvite}>
                          <input type="hidden" name="tournament_id" value={id} />
                          <input type="hidden" name="team_id" value={e.team_id!} />
                          <button
                            type="submit"
                            className="min-h-11 inline-flex items-center px-2 text-xs text-emerald-700 hover:underline"
                            title="Confirm this team on behalf of the partner"
                          >
                            Accept for partner
                          </button>
                        </form>
                        <form action={tdDeclineTeamInvite}>
                          <input type="hidden" name="tournament_id" value={id} />
                          <input type="hidden" name="team_id" value={e.team_id!} />
                          <button
                            type="submit"
                            className="min-h-11 inline-flex items-center px-2 text-xs text-red-700 hover:underline"
                            title="Decline this team on behalf of the partner"
                          >
                            Decline for partner
                          </button>
                        </form>
                      </>
                    )}
                    <form action={tdWithdrawEntry}>
                      <input type="hidden" name="tournament_id" value={id} />
                      <input type="hidden" name="entry_id" value={e.id} />
                      <button
                        type="submit"
                        className="min-h-11 inline-flex items-center px-2 text-xs text-red-700 hover:underline"
                      >
                        Withdraw
                      </button>
                    </form>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
