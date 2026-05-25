import {
  acceptInvite,
  declineInvite,
  register,
  registerTeam,
  withdrawSelf,
} from '@/app/tournaments/entry-actions'

export type MyEntryState =
  | { kind: 'none' }
  | { kind: 'singles'; entryId: string; status: string }
  | {
      kind: 'team'
      role: 'captain' | 'partner'
      entryId: string
      entryStatus: string
      teamId: string
      inviteStatus: 'pending' | 'accepted' | 'declined'
      otherName: string | null
    }

type Props = {
  tournamentId: string
  kind: 'singles' | 'doubles'
  canRegister: boolean
  drawIsSet: boolean
  me: MyEntryState
}

export function RegisterPanel({
  tournamentId,
  kind,
  canRegister,
  drawIsSet,
  me,
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

  if (!canRegister) return null

  if (kind === 'doubles') {
    return (
      <form
        action={registerTeam}
        className="rounded border border-[var(--color-border)] bg-white p-4 space-y-2"
      >
        <input type="hidden" name="tournament_id" value={tournamentId} />
        <label className="block text-sm">
          <span>Doubles partner&apos;s email</span>
          <input
            type="email"
            name="partner_email"
            required
            placeholder="partner@example.com"
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <p className="text-xs text-[var(--color-muted)]">
          Your partner must have an account. They&apos;ll see the invite on the
          tournament page and on their home page.
        </p>
        <button
          type="submit"
          className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
        >
          Invite partner & register
        </button>
      </form>
    )
  }

  return (
    <form action={register}>
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <button
        type="submit"
        className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 hover:opacity-90"
      >
        Register
      </button>
    </form>
  )
}
