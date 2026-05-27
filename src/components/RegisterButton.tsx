import {
  acceptInvite,
  declineInvite,
  register,
  registerSoloInDoubles,
  registerTeam,
  withdrawSelf,
} from '@/app/tournaments/entry-actions'
import { Combobox, type ComboboxItem } from '@/components/Combobox'

export type MyEntryState =
  | { kind: 'none' }
  | { kind: 'singles'; entryId: string; status: string }
  /**
   * Solo sign-up in a doubles tournament — the player has an entry but
   * no team yet. They sit in this state until a TD pairs them with
   * another solo on the Roster page.
   */
  | { kind: 'solo_in_doubles'; entryId: string }
  | {
      kind: 'team'
      role: 'captain' | 'partner'
      entryId: string
      entryStatus: string
      teamId: string
      inviteStatus: 'pending' | 'accepted' | 'declined'
      otherName: string | null
    }

type TournamentStatus = 'draft' | 'open' | 'closed' | 'complete'
type DrawStatus = 'open' | 'seeded' | 'drawn' | 'in_progress' | 'complete'

type Props = {
  tournamentId: string
  kind: 'singles' | 'doubles'
  /** Calcutta-style: doubles tournament that only accepts solo sign-ups;
   *  the TD forms teams by hat draw later. When true, the partner picker
   *  is hidden and only the solo button is shown. */
  soloOnly?: boolean
  tournamentStatus: TournamentStatus
  drawStatus: DrawStatus
  canRegister: boolean
  drawIsSet: boolean
  me: MyEntryState
  /** Suggestions for the doubles partner picker. Each value is a
   *  club_members.id (what register_team_from_directory looks up). */
  partnerCandidates?: ComboboxItem[]
}

function closedReason(
  tournamentStatus: TournamentStatus,
  drawStatus: DrawStatus,
): string {
  if (tournamentStatus === 'draft') {
    return "Sign-ups aren't open yet. The tournament director will open the tournament when it's ready."
  }
  if (tournamentStatus === 'closed') {
    return 'Sign-ups for this tournament are closed.'
  }
  if (tournamentStatus === 'complete') {
    return 'This tournament is complete.'
  }
  if (drawStatus !== 'open') {
    return 'The draw has been set — new sign-ups are closed. Contact the tournament director to be added.'
  }
  return 'Sign-ups are unavailable right now.'
}

export function RegisterPanel({
  tournamentId,
  kind,
  soloOnly = false,
  tournamentStatus,
  drawStatus,
  canRegister,
  drawIsSet,
  me,
  partnerCandidates = [],
}: Props) {
  if (me.kind === 'singles') {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm">
          You&apos;re registered for this tournament.
          {me.status !== 'confirmed' && (
            <span className="ml-2 text-xs rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
              {me.status}
            </span>
          )}
        </p>
        {drawIsSet && (
          <p className="text-xs text-[var(--color-muted)]">
            The draw is set. Withdrawing now will hand any unplayed match to
            your opponent as a walkover.
          </p>
        )}
        <form action={withdrawSelf}>
          <input type="hidden" name="tournament_id" value={tournamentId} />
          <input type="hidden" name="entry_id" value={me.entryId} />
          <button
            type="submit"
            className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
          >
            Withdraw
          </button>
        </form>
      </div>
    )
  }

  if (me.kind === 'solo_in_doubles') {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-4 space-y-2">
        <p className="text-sm">
          You&apos;re signed up solo. The tournament director will pair you
          with another solo player before the draw is generated.
        </p>
        <form action={withdrawSelf}>
          <input type="hidden" name="tournament_id" value={tournamentId} />
          <input type="hidden" name="entry_id" value={me.entryId} />
          <button
            type="submit"
            className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
          >
            Withdraw
          </button>
        </form>
      </div>
    )
  }

  if (me.kind === 'team') {
    if (me.role === 'partner' && me.inviteStatus === 'pending') {
      return (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p className="text-sm">
            <strong>{me.otherName ?? 'Someone'}</strong> invited you to play
            doubles together.
          </p>
          <div className="flex gap-2">
            <form action={acceptInvite}>
              <input type="hidden" name="tournament_id" value={tournamentId} />
              <input type="hidden" name="team_id" value={me.teamId} />
              <button
                type="submit"
                className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
              >
                Accept
              </button>
            </form>
            <form action={declineInvite}>
              <input type="hidden" name="tournament_id" value={tournamentId} />
              <input type="hidden" name="team_id" value={me.teamId} />
              <button
                type="submit"
                className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Decline
              </button>
            </form>
          </div>
        </div>
      )
    }

    const label =
      me.role === 'captain'
        ? me.inviteStatus === 'pending'
          ? `Invited ${me.otherName ?? 'partner'} — awaiting acceptance.`
          : me.inviteStatus === 'accepted'
            ? `Registered with ${me.otherName ?? 'partner'}.`
            : `${me.otherName ?? 'Partner'} declined the invite.`
        : me.inviteStatus === 'accepted'
          ? `Registered with ${me.otherName ?? 'partner'}.`
          : `You declined ${me.otherName ?? 'this'} invite.`

    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm">{label}</p>
        {drawIsSet && me.inviteStatus !== 'declined' && (
          <p className="text-xs text-[var(--color-muted)]">
            The draw is set. Withdrawing now will hand any unplayed match to
            your opponents as a walkover.
          </p>
        )}
        {me.inviteStatus !== 'declined' && (
          <form action={withdrawSelf}>
            <input type="hidden" name="tournament_id" value={tournamentId} />
            <input type="hidden" name="entry_id" value={me.entryId} />
            <button
              type="submit"
              className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
            >
              Withdraw team
            </button>
          </form>
        )}
      </div>
    )
  }

  // me.kind === 'none' — the player hasn't signed up yet.
  if (!canRegister) {
    return (
      <div className="rounded border border-[var(--color-border)] bg-white p-4 space-y-2">
        <h2 className="font-semibold">Player Sign Up</h2>
        <p className="text-sm text-[var(--color-muted)]">
          {closedReason(tournamentStatus, drawStatus)}
        </p>
      </div>
    )
  }

  if (kind === 'doubles') {
    // Calcutta-style: no partner picker, only the solo button. The TD
    // forms teams by hat draw outside the app, so there's no concept of
    // "signing up with a partner" for this kind of tournament.
    if (soloOnly) {
      return (
        <div className="rounded border border-[var(--color-border)] bg-white p-4 space-y-3">
          <h2 className="font-semibold">Player Sign Up</h2>
          <p className="text-sm">
            This tournament is solo sign-up only — the TD will draw teams by
            hat before the bracket is built.
          </p>
          <form action={registerSoloInDoubles}>
            <input type="hidden" name="tournament_id" value={tournamentId} />
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
            >
              Sign me up
            </button>
          </form>
        </div>
      )
    }

    return (
      <div className="rounded border border-[var(--color-border)] bg-white p-4 space-y-4">
        <h2 className="font-semibold">Player Sign Up</h2>

        <form action={registerTeam} className="space-y-2">
          <input type="hidden" name="tournament_id" value={tournamentId} />
          <label className="block text-sm">
            <span>Doubles partner</span>
            <Combobox
              name="partner_club_member_id"
              items={partnerCandidates}
              required
              placeholder="Type your partner's name…"
              ariaLabel="Doubles partner"
            />
          </label>
          <p className="text-xs text-[var(--color-muted)]">
            Pick anyone from the club directory. If your partner already has
            an account, they&apos;ll see the invite on their home page. If
            not, their team entry will be waiting for them when they sign up.
          </p>
          <button
            type="submit"
            className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
          >
            Sign up &amp; invite partner
          </button>
        </form>

        {/* Solo path — for players who don't have a partner lined up.
            The TD pairs them with another solo on the Roster page
            before generating the draw. Visually divided so it doesn't
            look like part of the partner form above. */}
        <div className="pt-3 border-t border-[var(--color-border)] space-y-2">
          <p className="text-sm">Don&apos;t have a partner?</p>
          <form action={registerSoloInDoubles}>
            <input type="hidden" name="tournament_id" value={tournamentId} />
            <button
              type="submit"
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Sign up solo — pair me up later
            </button>
          </form>
          <p className="text-xs text-[var(--color-muted)]">
            You&apos;ll show up on the Roster as unpaired. The TD will match
            you with another solo before the draw is built.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      action={register}
      className="rounded border border-[var(--color-border)] bg-white p-4 space-y-3"
    >
      <h2 className="font-semibold">Player Sign Up</h2>
      <p className="text-sm text-[var(--color-muted)]">
        Sign up to play in this tournament. You can withdraw later from this
        same page if your plans change.
      </p>
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <button
        type="submit"
        className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
      >
        Sign me up
      </button>
    </form>
  )
}
