'use client'

import { useActionState, useEffect, useState } from 'react'
import { setRoundDeadline, type DeadlineResult } from '@/app/tournaments/actions'

type Props = {
  tournamentId: string
  round: number
  defaultValue: string
}

export function RoundDeadlineRow({ tournamentId, round, defaultValue }: Props) {
  const [state, formAction, pending] = useActionState<DeadlineResult | undefined, FormData>(
    setRoundDeadline,
    undefined,
  )
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!state) return
    setVisible(true)
    const id = window.setTimeout(() => setVisible(false), 2500)
    return () => window.clearTimeout(id)
  }, [state])

  return (
    <form action={formAction} className="flex items-end gap-3 flex-wrap">
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <input type="hidden" name="round" value={round} />
      <div className="text-sm font-medium pb-2">Round {round}</div>
      <label className="block flex-1 min-w-[200px]">
        <span className="text-xs text-[var(--color-muted)]">Deadline</span>
        <input
          type="datetime-local"
          name="deadline"
          defaultValue={defaultValue}
          className="mt-1 w-full rounded border border-[var(--color-border)] px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--color-accent)] text-white px-3 py-2 text-sm hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {visible && state && (
        <span
          className={`text-sm pb-2 ${state.ok ? 'text-green-700' : 'text-red-700'}`}
          role="status"
        >
          {state.message}
        </span>
      )}
    </form>
  )
}
