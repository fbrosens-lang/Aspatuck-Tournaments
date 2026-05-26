import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isTdOfTournament } from '@/lib/auth'
import {
  tdAcceptTeamInvite,
  tdDeclineTeamInvite,
  tdEnterMember,
  tdEnterGuest,
  tdEnterClubMember,
  tdEnterTeamFromClubMembers,
  tdWithdrawEntry,
  tdRegenerateDraw,
  tdClearDraw,
  tdGenerateDraw,
} from './actions'
import { loadEntriesForTournament } from '@/app/tournaments/[id]/load-entries'
import { Combobox, type ComboboxItem } from '@/components/Combobox'
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
    .select('id, name, kind, draw_status')
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
      <header>
        <Link
          href={`/tournaments/${id}`}
          className="text-sm text-[var(--color-muted)] hover:underline"
        >
          ← Tournament
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Roster · {tournament.name}</h1>
      </header>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {ok === 'generated' && 'Draw generated with the current roster.'}
          {ok === 'regenerated' && 'Draw regenerated with the current roster.'}
          {ok === 'cleared' &&
            'Draw cleared. Sign-ups are open again — players can register and you can regenerate when you’re ready.'}
          {ok === 'team_accepted' &&
            'Team invite accepted on behalf of the partner. The entry is now confirmed.'}
          {ok === 'team_declined' &&
            'Team invite declined on behalf of the partner. The entry has been withdrawn.'}
          {ok !== 'generated' &&
            ok !== 'regenerated' &&
            ok !== 'cleared' &&
            ok !== 'team_accepted' &&
            ok !== 'team_declined' &&
            'Saved.'}
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
              someone who isn&apos;t in the directory, add them as a guest on
              the{' '}
              <Link
                href={`/tournaments/${id}/participants`}
                className="underline"
              >
                Participants page
              </Link>{' '}
              first.
            </p>
            <form
              action={tdEnterClubMember}
              className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            >
              <input type="hidden" name="tournament_id" value={id} />
              <label className="block sm:col-span-3">
                <span className="text-sm">Club member</span>
                <Combobox
                  name="club_member_id"
                  items={clubMemberItems}
                  required
                  placeholder="Type a name…"
                  ariaLabel="Club member"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="bypass" /> Bypass requirements
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
              <label className="block sm:col-span-3">
                <span className="text-sm">Account</span>
                <Combobox
                  name="user_id"
                  items={memberItems}
                  required
                  placeholder="Type a name…"
                  ariaLabel="Registered user"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="bypass" /> Bypass requirements
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
            <h2 className="font-medium mb-3">Enter a guest</h2>
            {(!guests || guests.length === 0) ? (
              <p className="text-sm text-[var(--color-muted)]">
                No guests yet —{' '}
                <Link href={`/tournaments/${id}/participants`} className="underline">
                  add one
                </Link>{' '}
                first.
              </p>
            ) : (
              <form action={tdEnterGuest} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <input type="hidden" name="tournament_id" value={id} />
                <label className="block sm:col-span-3">
                  <span className="text-sm">Guest participant</span>
                  <Combobox
                    name="participant_id"
                    items={guestItems}
                    required
                    placeholder="Type a name…"
                    ariaLabel="Guest participant"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="bypass" /> Bypass requirements
                </label>
                <button
                  type="submit"
                  className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90 sm:col-span-4 justify-self-start"
                >
                  Enter guest
                </button>
              </form>
            )}
          </section>
        </>
      )}

      {tournament.kind === 'doubles' && (
        <section className="bg-white border border-[var(--color-border)] rounded p-4">
          <h2 className="font-medium mb-3">Enter a doubles team</h2>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            Pick both partners from the club directory. They&apos;re entered as
            members whether or not they have an account. To add someone who
            isn&apos;t in the directory, add them as a guest on the{' '}
            <Link
              href={`/tournaments/${id}/participants`}
              className="underline"
            >
              Participants page
            </Link>{' '}
            first.
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
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="bypass" /> Bypass requirements
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

      <section>
        <h2 className="font-medium mb-3">
          Current entries{' '}
          <span className="text-sm text-[var(--color-muted)] font-normal">({entries.length})</span>
        </h2>
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
                <li key={e.id} className="px-4 py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-[var(--color-muted)] w-6">{e.seed ?? ''}</span>
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
                  <div className="flex items-center gap-3 shrink-0">
                    {pendingTeamInvite && (
                      <>
                        <form action={tdAcceptTeamInvite}>
                          <input type="hidden" name="tournament_id" value={id} />
                          <input type="hidden" name="team_id" value={e.team_id!} />
                          <button
                            type="submit"
                            className="text-xs text-emerald-700 hover:underline"
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
                            className="text-xs text-red-700 hover:underline"
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
                        className="text-xs text-red-700 hover:underline"
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
