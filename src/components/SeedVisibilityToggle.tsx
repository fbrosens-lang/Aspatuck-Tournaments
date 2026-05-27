'use client'

import { useRef, useState } from 'react'
import { setSeedsVisibility } from '@/app/tournaments/[id]/entries/actions'

type Props = {
  tournamentId: string
  showSeedsPublicly: boolean
  /** Where the action should redirect after saving. Defaults to the Roster. */
  returnTo?: 'entries' | 'manage'
}

export function SeedVisibilityToggle({
  tournamentId,
  showSeedsPublicly,
  returnTo = 'entries',
}: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  // Track the in-flight state so the status text and color update immediately
  // when the box is clicked, before the server round-trip lands.
  const [checked, setChecked] = useState(showSeedsPublicly)

  return (
    <form ref={formRef} action={setSeedsVisibility} className="block">
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <fieldset className="rounded border border-[var(--color-border)] p-3">
        <legend className="text-sm px-1">Visibility</legend>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="show_seeds_publicly"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked)
              formRef.current?.requestSubmit()
            }}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Show seed numbers to players
            <span
              className={`block text-xs font-medium ${
                checked ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              Currently {checked ? 'shown to players' : 'hidden from players'}.
            </span>
            <span className="block text-xs text-[var(--color-muted)]">
              When unchecked, players see the entries list and bracket without
              seed numbers. You can still set and use seeds behind the scenes.
            </span>
          </span>
        </label>
        {/* Fallback for users without JavaScript — the onChange handler above
            normally submits on click, but a visible button still lets the
            form work if scripts are disabled. */}
        <noscript>
          <button
            type="submit"
            className="mt-2 text-xs rounded border border-[var(--color-border)] px-2 py-1 hover:bg-zinc-50"
          >
            Save
          </button>
        </noscript>
      </fieldset>
    </form>
  )
}
