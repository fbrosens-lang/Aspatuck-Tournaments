import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession, isTdOfTournament } from '@/lib/auth'
import {
  grantTd,
  revokeTd,
  setRoundDeadline,
  updateTournament,
} from '@/app/tournaments/actions'
import { TournamentRulesFields } from '@/components/TournamentRulesFields'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}

const OK_MESSAGES: Record<string, string> = {
  '1': 'Saved.',
  deadline: 'Deadline updated.',
  td_granted: 'Director added.',
  td_revoked: 'Director removed.',
}

function toLocalInput(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default async function ManageTournamentPage({ params, searchParams }: Props) {
  const { id } = await params
  const { error, ok } = await searchParams

  if (!(await isTdOfTournament(id))) {
    redirect(`/tournaments/${id}`)
  }

  const { userId } = await getSession()
  const supabase = await createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select(
      'id, name, start_date, end_date, registration_deadline, status, kind, bracket_format, match_kind, final_set_format, sets_to_win, games_per_set, tiebreak_at, requires_dob, registration_deadline_override, draw_status',
    )
    .eq('id', id)
    .maybeSingle()
  if (!t) notFound()

  const [{ data: roundRows }, { data: deadlineRows }, { data: tdRows }] =
    await Promise.all([
      supabase.from('matches').select('round').eq('tournament_id', id),
      supabase
        .from('tournament_round_deadlines')
        .select('round, deadline')
        .eq('tournament_id', id),
      supabase
        .from('tournament_directors')
        .select('user_id')
        .eq('tournament_id', id),
    ])

  const rounds = Array.from(
    new Set((roundRows ?? []).map((r) => r.round as number)),
  ).sort((a, b) => a - b)
  const deadlineByRound = new Map(
    (deadlineRows ?? []).map((r) => [r.round as number, r.deadline as string]),
  )

  const tdUserIds = (tdRows ?? []).map((r) => r.user_id as string)
  const { data: tdProfiles } = tdUserIds.length
    ? await supabase
        .from('profiles')
        .select('id, full_name, contact_email')
        .in('id', tdUserIds)
    : { data: [] }

  return (
    <div className="max-w-xl mx-auto py-6 space-y-8">
      <h1 className="text-2xl font-semibold">Manage tournament</h1>
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

      <form action={updateTournament} className="space-y-4">
        <input type="hidden" name="id" value={t.id} />
        <label className="block">
          <span className="text-sm">Name</span>
          <input
            name="name"
            required
            defaultValue={t.name}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">Start date</span>
            <input
              type="date"
              name="start_date"
              required
              defaultValue={t.start_date}
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm">End date</span>
            <input
              type="date"
              name="end_date"
              required
              defaultValue={t.end_date}
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm">Registration deadline (optional)</span>
          <input
            type="datetime-local"
            name="registration_deadline"
            defaultValue={toLocalInput(t.registration_deadline)}
            className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
          />
        </label>

        <TournamentRulesFields
          mode="edit"
          initial={{
            kind: t.kind,
            bracket_format: t.bracket_format,
            match_kind: t.match_kind,
            final_set_format: t.final_set_format,
            sets_to_win: t.sets_to_win,
            games_per_set: t.games_per_set,
            tiebreak_at: t.tiebreak_at,
            requires_dob: t.requires_dob,
            registration_deadline_override: t.registration_deadline_override,
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">Tournament status</span>
            <select
              name="status"
              defaultValue={t.status}
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            >
              <option value="draft">draft</option>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="complete">complete</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm">Draw status</span>
            <select
              name="draw_status"
              defaultValue={t.draw_status}
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            >
              <option value="open">open</option>
              <option value="seeded">seeded</option>
              <option value="drawn">drawn</option>
              <option value="in_progress">in_progress</option>
              <option value="complete">complete</option>
            </select>
          </label>
        </div>

        <button
          type="submit"
          className="rounded bg-[var(--color-accent)] text-white px-4 py-2 hover:opacity-90"
        >
          Save
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Round deadlines</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Optional per-round deadlines for completing matches. Leave blank to
          clear a round&apos;s deadline.
        </p>
        {rounds.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            No rounds yet — generate the draw first.
          </p>
        ) : (
          <ul className="space-y-2">
            {rounds.map((r) => (
              <li
                key={r}
                className="rounded border border-[var(--color-border)] bg-white p-3"
              >
                <form
                  action={setRoundDeadline}
                  className="flex items-end gap-3 flex-wrap"
                >
                  <input type="hidden" name="tournament_id" value={t.id} />
                  <input type="hidden" name="round" value={r} />
                  <div className="text-sm font-medium pb-2">Round {r}</div>
                  <label className="block flex-1 min-w-[200px]">
                    <span className="text-xs text-[var(--color-muted)]">
                      Deadline
                    </span>
                    <input
                      type="datetime-local"
                      name="deadline"
                      defaultValue={toLocalInput(
                        deadlineByRound.get(r) ?? null,
                      )}
                      className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded bg-[var(--color-accent)] text-white px-3 py-2 text-sm hover:opacity-90"
                  >
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">Tournament directors</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Anyone listed here can manage this tournament (edit the draw, override
          scores, change settings).
        </p>
        {tdProfiles && tdProfiles.length > 0 ? (
          <ul className="rounded border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
            {tdProfiles.map((p) => (
              <li
                key={p.id}
                className="px-4 py-2 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm">{p.full_name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {p.contact_email}
                  </p>
                </div>
                {p.id !== userId && (
                  <form action={revokeTd}>
                    <input type="hidden" name="tournament_id" value={t.id} />
                    <input type="hidden" name="user_id" value={p.id} />
                    <button
                      type="submit"
                      className="text-xs text-red-700 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            No directors listed yet.
          </p>
        )}
        <form
          action={grantTd}
          className="rounded border border-[var(--color-border)] bg-white p-3 space-y-2"
        >
          <input type="hidden" name="tournament_id" value={t.id} />
          <label className="block text-sm">
            <span>Add a director by email</span>
            <input
              type="email"
              name="email"
              required
              placeholder="director@example.com"
              className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-[var(--color-accent)] text-white px-3 py-1.5 text-sm hover:opacity-90"
          >
            Add director
          </button>
        </form>
      </section>
    </div>
  )
}
